/**
 * Python execution Web Worker using Pyodide (CPython compiled to WASM).
 *
 * Loads Pyodide on first use, caches in memory for subsequent runs,
 * captures stdout/stderr, and sends results to the main thread.
 *
 * RL-083 Slice 1 — desktop/dev resolve `pyodide.mjs` against the
 * renderer build output (file:// in packaged Electron, the dev server
 * origin in `npm run dev:desktop`). The build pipeline copies
 * `node_modules/pyodide/*` to `<outDir>/pyodide/` via
 * `build/copyRuntimeAssetsPlugin.mts`. The web build explicitly
 * overrides the index URL to the CDN until Slice 2 picks the
 * first-party hosting path.
 *
 * RL-078: this worker no longer schedules its own deadline. The
 * parent renderer thread owns a kill timer and calls
 * `worker.terminate()` if user code does not yield in time. Each
 * `execute` request carries a `runId` that the worker echoes on
 * every reply so the parent can drop messages from a previous
 * (terminated) run.
 */

import { syncUserEnvInPyodide } from './python-worker-env';
import { truncateSerialized } from '../runners/limits';
import {
  DEFAULT_SCOPE_DEPTH,
  INTERNAL_PYTHON_SYMBOLS,
  MAX_ARRAY_ENTRIES,
  MAX_OBJECT_ENTRIES,
  MAX_SCOPE_DEPTH,
  MAX_TOP_LEVEL_VARS,
  type ScopeSnapshot,
  type ScopeValue,
  type ScopeVariable,
  finalizeScopeSnapshot,
} from '../../shared/scopeSnapshot';

const ctx = self as unknown as Worker;

// Renderer-relative URL of the locally-served Pyodide directory.
//
// In packaged Electron the worker chunk lives at
// `<outDir>/assets/workers-XYZ.js` and `../pyodide/` resolves to
// `<outDir>/pyodide/`, where `build/copyRuntimeAssetsPlugin.mts`
// copies the files at build time.
//
// In `npm run dev:desktop` Vite serves the worker source at
// `/src/renderer/workers/python-worker.ts`, so `../pyodide/` lands at
// `/src/renderer/pyodide/` — the same plugin's `configureServer`
// middleware serves the same files there from `node_modules/pyodide/`.
//
// Keep this as a runtime URL instead of asking Vite to fingerprint a
// directory. The copy plugin owns the actual files, and the web build
// may override the URL to the CDN before this fallback is used.
const RAW_PYODIDE_INDEX_URL = new URL(
  /* @vite-ignore */ '../pyodide/',
  import.meta.url
).href;

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolvePyodideIndexUrl(): string {
  const configuredUrl =
    typeof __LINGUA_PYODIDE_INDEX_URL__ === 'string'
      ? __LINGUA_PYODIDE_INDEX_URL__.trim()
      : '';
  return withTrailingSlash(configuredUrl || RAW_PYODIDE_INDEX_URL);
}

const PYODIDE_INDEX_URL = resolvePyodideIndexUrl();

let pyodide: unknown = null;
let appliedUserEnvKeys: string[] = [];
let activeRunId: string | null = null;
/**
 * RL-020 Slice 9 — Pyodide globals captured before the first user
 * run executes. The variable inspector subtracts this set from
 * `globals().keys()` so only user-declared bindings (and post-boot
 * imports the user pulled in) survive the filter.
 *
 * `null` until the first capture-enabled run primes it; the prime
 * happens inside the bootstrap `runPythonAsync` block so the
 * subtraction works on the very first capture too.
 */
let pythonBootGlobals: ReadonlySet<string> | null = null;

const FALLBACK_RESULT_TRUNCATION_MARKER = '[result truncated]';

function truncate(value: string, marker: string): string {
  return truncateSerialized(value, marker);
}

type PyodideRuntime = {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout?: (options: { batched: (text: string) => void }) => void;
  setStderr?: (options: { batched: (text: string) => void }) => void;
  /**
   * RL-020 Slice 6 — Pyodide ≥ 0.24 stdin redirect API. The callback
   * returns one chunk at a time (string per `input()` line in
   * practice); returning `null` / `undefined` signals EOF and
   * Pyodide raises `EOFError` in the user's code (stock Python
   * REPL behavior). Calling `setStdin()` with no arg resets back
   * to Pyodide's default handler.
   */
  setStdin?: (options?: {
    stdin?: () => string | null | undefined;
    error?: boolean;
    isatty?: boolean;
  }) => void;
  globals: {
    set(name: string, value: unknown): void;
    delete?(name: string): void;
  };
};

type PyodideLoaderModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<unknown>;
};

async function loadPyodide(): Promise<unknown> {
  if (pyodide) return pyodide;

  // Module workers cannot use importScripts. Load Pyodide's ESM entry
  // from the locally-served copy so Electron, the dev server, and the
  // packaged renderer all read from the same origin.
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
  )) as PyodideLoaderModule;
  pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  const runtime = pyodide as PyodideRuntime;
  // The user-code path redirects sys.stdout / sys.stderr into
  // `__lingua_stdout` / `__lingua_stderr` (see the `execute` block
  // below) and reads them back via `runPythonAsync`. These
  // `setStdout` / `setStderr` callbacks therefore only fire for
  // Pyodide host-level chatter that arrives outside that redirect
  // — typically during the one-time `loadPyodide` boot. We still
  // gate on `activeRunId` so that a stray late-flushed chunk
  // arriving between runs is dropped here instead of being tagged
  // with the wrong run's id.
  runtime.setStdout?.({
    batched: (text: string) => {
      if (text.length > 0 && activeRunId) {
        ctx.postMessage({
          type: 'console',
          runId: activeRunId,
          method: 'log',
          args: [text],
        });
      }
    },
  });
  runtime.setStderr?.({
    batched: (text: string) => {
      if (text.length > 0 && activeRunId) {
        ctx.postMessage({
          type: 'console',
          runId: activeRunId,
          method: 'error',
          args: [text],
        });
      }
    },
  });

  return pyodide;
}

/** Parse Python traceback to extract line/column */
function parsePythonError(errorText: string): { line?: number; message: string } {
  // Look for "File "<exec>", line N" pattern
  const lineMatch = errorText.match(/File\s+"<exec>",\s+line\s+(\d+)/);
  // Get the last line as the actual error message
  const lines = errorText.trim().split('\n');
  const message = lines.at(-1) || errorText;
  const lineValue = lineMatch?.[1];

  return {
    line: lineValue ? parseInt(lineValue, 10) : undefined,
    message,
  };
}

/**
 * RL-020 Slice 9 — Python-side scope capture.
 *
 * Two helpers below:
 *
 *   - `primePythonBootGlobalsIfNeeded(py)`: runs ONCE the first time
 *     a capture-enabled run completes. Stores the names that exist
 *     in the worker's `globals()` immediately AFTER the bootstrap
 *     block (so `__lingua_*` helpers + imported `io` / `sys` /
 *     `json` are in the boot set). On subsequent runs, the walker
 *     subtracts this set so only user-declared bindings survive.
 *     Also adds `INTERNAL_PYTHON_SYMBOLS` defensively.
 *   - `capturePythonScope(py, scopeDepth)`: runs a Python snippet
 *     after user code that builds a JSON-encoded list of
 *     `{name, value}` pairs using a recursive walker (1-level
 *     default, depth-capped). Returns a `ScopeSnapshot` ready
 *     for postMessage.
 *
 * The Python walker mirrors `serializeScopeValue` in
 * `src/shared/scopeSnapshot.ts`. The two implementations are kept
 * in lockstep by their type definitions; a regression on one side
 * surfaces in the shared test fixture.
 */

const PYTHON_CAPTURE_HELPER_SRC = `
def __lingua_capture_scope(depth, max_top_level, max_object_entries, max_array_entries, internal_symbols):
    import json as __lingua_json_local
    PRIMITIVE_REPR_MAX = 200
    boot = globals().get('__lingua_boot_globals', frozenset())
    seen_ids = set()
    def trunc(s):
        if len(s) > PRIMITIVE_REPR_MAX:
            return s[:PRIMITIVE_REPR_MAX] + '...'
        return s
    def walk(v, d):
        if v is None:
            return {"kind": "primitive", "type": "null", "repr": "None"}
        if isinstance(v, bool):
            return {"kind": "primitive", "type": "boolean", "repr": "True" if v else "False"}
        if isinstance(v, int):
            return {"kind": "primitive", "type": "number", "repr": trunc(str(v))}
        if isinstance(v, float):
            return {"kind": "primitive", "type": "number", "repr": trunc(str(v))}
        if isinstance(v, str):
            return {"kind": "primitive", "type": "string", "repr": trunc(repr(v))}
        if isinstance(v, bytes):
            return {"kind": "primitive", "type": "string", "repr": trunc(repr(v))}
        if callable(v):
            name = getattr(v, '__name__', None) or 'anonymous'
            return {"kind": "function", "name": str(name)}
        try:
            ident = id(v)
        except Exception:
            ident = None
        if ident is not None and ident in seen_ids:
            return {"kind": "error", "message": "Circular reference"}
        if ident is not None:
            seen_ids.add(ident)
        if isinstance(v, (list, tuple, set, frozenset)):
            try:
                items = list(v)
            except Exception:
                return {"kind": "primitive", "type": "string", "repr": trunc(repr(v))}
            length = len(items)
            if d >= depth:
                return {"kind": "array", "length": length, "entries": []}
            cap = min(length, max_array_entries)
            entries = []
            for index in range(cap):
                try:
                    entries.append({"index": index, "value": walk(items[index], d + 1)})
                except Exception as ex:
                    entries.append({"index": index, "value": {"kind": "error", "message": str(ex)[:PRIMITIVE_REPR_MAX]}})
            payload = {"kind": "array", "length": length, "entries": entries}
            if length > cap:
                payload["truncatedCount"] = length - cap
            return payload
        if isinstance(v, dict):
            try:
                keys = list(v.keys())
            except Exception:
                return {"kind": "primitive", "type": "string", "repr": trunc(repr(v))}
            length = len(keys)
            preview_type = type(v).__name__ or 'dict'
            if d >= depth:
                return {"kind": "object", "previewType": preview_type, "entries": []}
            cap = min(length, max_object_entries)
            entries = []
            for index in range(cap):
                key = keys[index]
                try:
                    entries.append({"key": str(key), "value": walk(v[key], d + 1)})
                except Exception as ex:
                    entries.append({"key": str(key), "value": {"kind": "error", "message": str(ex)[:PRIMITIVE_REPR_MAX]}})
            payload = {"kind": "object", "previewType": preview_type, "entries": entries}
            if length > cap:
                payload["truncatedCount"] = length - cap
            return payload
        # Fallback for arbitrary objects — surface as object with __dict__ entries
        preview_type = type(v).__name__ or 'object'
        attrs = {}
        try:
            attrs = vars(v)
        except Exception:
            return {"kind": "primitive", "type": "string", "repr": trunc(repr(v))}
        if d >= depth:
            return {"kind": "object", "previewType": preview_type, "entries": []}
        keys = list(attrs.keys())
        length = len(keys)
        cap = min(length, max_object_entries)
        entries = []
        for index in range(cap):
            key = keys[index]
            if key.startswith('__'):
                continue
            try:
                entries.append({"key": str(key), "value": walk(attrs[key], d + 1)})
            except Exception as ex:
                entries.append({"key": str(key), "value": {"kind": "error", "message": str(ex)[:PRIMITIVE_REPR_MAX]}})
        payload = {"kind": "object", "previewType": preview_type, "entries": entries}
        if length > len(entries):
            payload["truncatedCount"] = length - len(entries)
        return payload
    pairs = []
    name_list = list(globals().keys())
    user_names = [n for n in name_list if n not in boot and n not in internal_symbols]
    user_names = user_names[:max_top_level]
    truncated = 0
    total = len([n for n in name_list if n not in boot and n not in internal_symbols])
    if total > len(user_names):
        truncated = total - len(user_names)
    for name in user_names:
        try:
            pairs.append({"name": name, "value": walk(globals()[name], 0)})
        except Exception as ex:
            pairs.append({"name": name, "value": {"kind": "error", "message": str(ex)[:PRIMITIVE_REPR_MAX]}})
    payload = {"variables": pairs}
    if truncated > 0:
        payload["truncatedCount"] = truncated
    return __lingua_json_local.dumps(payload)
`;

async function primePythonBootGlobalsIfNeeded(py: PyodideRuntime): Promise<void> {
  if (pythonBootGlobals !== null) return;
  // Snapshot globals AFTER the bootstrap block has run but BEFORE
  // any user code executes on this run. The bootstrap inside the
  // execute branch above adds `__lingua_*` names; those land in the
  // boot set so subsequent captures filter them out automatically.
  const snapshot = await py.runPythonAsync(`
import json as __lingua_json_boot
__lingua_boot_globals = frozenset(globals().keys()) | {'__lingua_boot_globals', '__lingua_capture_scope', '__lingua_json_boot'}
__lingua_json_boot.dumps(sorted(list(__lingua_boot_globals)))
`);
  const list = typeof snapshot === 'string' ? (JSON.parse(snapshot) as string[]) : [];
  pythonBootGlobals = new Set(list);
}

async function capturePythonScope(
  py: PyodideRuntime,
  scopeDepth: number | undefined
): Promise<ScopeSnapshot> {
  const depth =
    typeof scopeDepth === 'number' && scopeDepth > 0
      ? Math.min(Math.floor(scopeDepth), MAX_SCOPE_DEPTH)
      : DEFAULT_SCOPE_DEPTH;
  // Define the capture helper if not already in scope. Idempotent —
  // Python re-defines the function on every call which is cheap.
  await py.runPythonAsync(PYTHON_CAPTURE_HELPER_SRC);
  // Invoke the helper with caps + the JS-side internal symbol set.
  // `repr(set)` produces a Python-evaluable literal so we pass the
  // names as a JSON list and reconstruct on the Python side.
  const internalSymbolsJson = JSON.stringify(
    Array.from(INTERNAL_PYTHON_SYMBOLS)
  );
  const result = await py.runPythonAsync(
    `__lingua_capture_scope(${depth}, ${MAX_TOP_LEVEL_VARS}, ${MAX_OBJECT_ENTRIES}, ${MAX_ARRAY_ENTRIES}, set(__lingua_json_boot.loads('${internalSymbolsJson.replace(/'/g, "\\'")}')))`
  );
  if (typeof result !== 'string') {
    return finalizeScopeSnapshot('python', []);
  }
  let parsed: { variables: ScopeVariable[]; truncatedCount?: number };
  try {
    parsed = JSON.parse(result) as {
      variables: ScopeVariable[];
      truncatedCount?: number;
    };
  } catch {
    return finalizeScopeSnapshot('python', []);
  }
  // Defensive shape coercion — strip anything that isn't a known
  // ScopeValue kind so the renderer never has to validate the wire
  // payload.
  const variables = Array.isArray(parsed.variables)
    ? parsed.variables.filter((v) => typeof v?.name === 'string' && coerceScopeValue(v.value) !== null)
    : [];
  const finalized = finalizeScopeSnapshot('python', variables);
  if (
    typeof parsed.truncatedCount === 'number' &&
    parsed.truncatedCount > 0 &&
    finalized.truncatedCount === undefined
  ) {
    return { ...finalized, truncatedCount: parsed.truncatedCount };
  }
  return finalized;
}

/**
 * Defensive coercion — accept only ScopeValue shapes we recognize.
 * Returns `null` if the payload is malformed.
 */
function coerceScopeValue(value: unknown): ScopeValue | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { kind?: unknown };
  if (
    v.kind !== 'primitive' &&
    v.kind !== 'function' &&
    v.kind !== 'object' &&
    v.kind !== 'array' &&
    v.kind !== 'error'
  ) {
    return null;
  }
  return value as ScopeValue;
}

function postBufferedOutput(
  runId: string,
  method: 'log' | 'error',
  text: string
): void {
  for (const line of text.split('\n').filter((entry) => entry.trim() !== '')) {
    ctx.postMessage({ type: 'console', runId, method, args: [line] });
  }
}

ctx.addEventListener('message', async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      ctx.postMessage({ type: 'loading', stage: 'Loading Python runtime...' });
      await loadPyodide();
      ctx.postMessage({ type: 'ready' });
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        error: {
          message: `Failed to load Pyodide: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    return;
  }

  if (msg.type === 'execute') {
    const {
      runId,
      code,
      userEnv,
      resultTruncationMarker,
      stdin,
      captureScope,
      scopeDepth,
    } = msg as {
      runId: string;
      code: string;
      userEnv?: Record<string, string>;
      resultTruncationMarker?: string;
      /**
       * RL-020 Slice 6 — pre-set stdin buffer. Newline-delimited;
       * `input()` consumes one line per call. Empty / undefined
       * leaves Pyodide's default handler so a bare `input()` call
       * raises `EOFError` (stock Python REPL behavior).
       */
      stdin?: string;
      /**
       * RL-020 Slice 9 — when `true`, capture the post-execute
       * globals and emit a `'scope-snapshot'` reply before `done`.
       */
      captureScope?: boolean;
      /**
       * RL-020 Slice 9 fold E — recursion depth for the scope
       * walker (1–4). Defaults to 1 in `serializeScopeValueFromPyObject`.
       */
      scopeDepth?: number;
    };
    const marker =
      typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
        ? resultTruncationMarker
        : FALLBACK_RESULT_TRUNCATION_MARKER;
    const startTime = performance.now();
    activeRunId = runId;

    // RL-020 Slice 6 — line-by-line stdin reader. We split the
    // buffer up front so per-`input()` consumption is O(1) and the
    // consumed count is observable for the fold-G summary.
    const rawStdinLines =
      typeof stdin === 'string' && stdin.length > 0
        ? (() => {
            const parts = stdin.split('\n');
            if (parts.length > 0 && parts[parts.length - 1] === '') {
              parts.pop();
            }
            return parts;
          })()
        : [];
    let stdinCursor = 0;
    const stdinTotal = rawStdinLines.length;

    try {
      const py = (await loadPyodide()) as PyodideRuntime;

      // RL-020 Slice 6 — install the stdin handler ONLY when the
      // user typed something into the panel. Empty / undefined
      // leaves Pyodide's stock handler (which raises EOFError on
      // bare `input()`) — matches the documented panel hint.
      if (stdinTotal > 0 && typeof py.setStdin === 'function') {
        py.setStdin({
          stdin: () => {
            if (stdinCursor >= rawStdinLines.length) return null;
            const value = rawStdinLines[stdinCursor]!;
            stdinCursor += 1;
            // Pyodide expects the next chunk of stdin including the
            // line terminator; appending `\n` matches `input()`'s
            // line semantics.
            return `${value}\n`;
          },
          isatty: false,
        });
      }

      // RL-011 Slice D third increment — bridge user-space env into
      // Pyodide's os.environ so user code can call os.getenv(...) just
      // like the Go and Rust subprocess paths. Because this worker is
      // persistent, we must also remove keys that disappeared between
      // runs; otherwise stale values would linger in os.environ after
      // the user clears or renames a var.
      appliedUserEnvKeys = await syncUserEnvInPyodide(
        py,
        userEnv,
        appliedUserEnvKeys
      );

      await py.runPythonAsync(`
import io
import sys
import json as __lingua_json
__lingua_stdout = io.StringIO()
__lingua_stderr = io.StringIO()
__lingua_prev_stdout = sys.stdout
__lingua_prev_stderr = sys.stderr
sys.stdout = __lingua_stdout
sys.stderr = __lingua_stderr

__lingua_magic_results = []
def __mc(line, expr_fn):
    try:
        val = expr_fn()
        __lingua_magic_results.append({"line": line, "value": repr(val)})
        return val
    except Exception as e:
        __lingua_magic_results.append({"line": line, "value": str(e)})
        return None
      `);

      if (captureScope === true) {
        await primePythonBootGlobalsIfNeeded(py);
      }

      // RL-078: deadline enforcement is parent-owned. We just run.
      let result: unknown;
      let errorText: string | null = null;

      try {
        result = await py.runPythonAsync(code);
      } catch (err) {
        errorText = err instanceof Error ? err.message : String(err);
      }

      const streamState = await py.runPythonAsync(`
import sys
_lingua_state = __lingua_json.dumps({
    "stdout": __lingua_stdout.getvalue(),
    "stderr": __lingua_stderr.getvalue(),
    "magic": __lingua_magic_results,
})
sys.stdout = __lingua_prev_stdout
sys.stderr = __lingua_prev_stderr
__lingua_magic_results = []
_lingua_state
      `);

      const streams =
        typeof streamState === 'string'
          ? (JSON.parse(streamState) as { stdout: string; stderr: string; magic?: Array<{ line: number; value: string }> })
          : { stdout: '', stderr: '' };

      postBufferedOutput(runId, 'log', streams.stdout);
      postBufferedOutput(runId, 'error', streams.stderr);

      // Send magic comment results
      if (streams.magic) {
        for (const entry of streams.magic) {
          ctx.postMessage({
            type: 'magic-comment',
            runId,
            line: entry.line,
            value: truncate(entry.value, marker),
          });
        }
      }

      // Send result if non-None
      if (result !== undefined && result !== null) {
        const resultStr = typeof result === 'object' && result && 'toString' in result
          ? (result as { toString(): string }).toString()
          : String(result);
        if (resultStr !== 'None') {
          ctx.postMessage({
            type: 'result',
            runId,
            value: truncate(resultStr, marker),
          });
        }
      }

      if (errorText) {
        const parsed = parsePythonError(streams.stderr || errorText);
        ctx.postMessage({
          type: 'error',
          runId,
          error: {
            message: parsed.message,
            line: parsed.line,
          },
        });
      }

      // RL-020 Slice 9 — capture the post-execute globals BEFORE
      // the stdin-consumed / done replies. Runs only when the runner
      // asked (`captureScope === true`); the runner asks when the
      // inspector toggle is on for the active tab OR when the user
      // wants the toggle to light up after the next run. The first
      // capture primes `pythonBootGlobals` so subsequent runs can
      // subtract the boot-time set.
      if (captureScope === true && !errorText) {
        try {
          const snapshot = await capturePythonScope(py, scopeDepth);
          ctx.postMessage({ type: 'scope-snapshot', runId, snapshot });
        } catch (captureErr) {
          ctx.postMessage({
            type: 'scope-snapshot',
            runId,
            snapshot: finalizeScopeSnapshot('python', []),
            error:
              captureErr instanceof Error
                ? captureErr.message
                : String(captureErr),
          });
        }
      }

      // RL-020 Slice 6 fold G — emit consumption summary BEFORE
      // `done` so the runner can stitch it onto `ExecutionResult`.
      if (stdinTotal > 0) {
        ctx.postMessage({
          type: 'stdin-consumed',
          runId,
          count: stdinCursor,
          total: stdinTotal,
        });
      }

      ctx.postMessage({
        type: 'done',
        runId,
        executionTime: performance.now() - startTime,
      });
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const parsed = parsePythonError(errorText);

      ctx.postMessage({
        type: 'error',
        runId,
        error: {
          message: parsed.message,
          line: parsed.line,
        },
      });

      if (stdinTotal > 0) {
        ctx.postMessage({
          type: 'stdin-consumed',
          runId,
          count: stdinCursor,
          total: stdinTotal,
        });
      }

      ctx.postMessage({
        type: 'done',
        runId,
        executionTime: performance.now() - startTime,
      });
    } finally {
      activeRunId = null;
      // RL-020 Slice 6 — restore Pyodide's stock stdin handler so
      // the next run starts on a clean baseline (the worker is
      // persistent unlike js-worker.ts).
      if (stdinTotal > 0 && pyodide) {
        const runtime = pyodide as PyodideRuntime;
        runtime.setStdin?.();
      }
    }
  }
});

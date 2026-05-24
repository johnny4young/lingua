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
import {
  validateChartSpec,
  validateImageSrc,
  validateHtmlPayload,
  type RichOutputPayload,
} from '../../shared/richOutput';
import { parsePythonTraceback } from '../../shared/errorStack';
import type {
  DependencyInstallFailureReason,
  DependencyInstallOutcome,
} from '../../shared/dependencies/types';

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

/**
 * RL-025 Slice C — minimal shape of a Python module proxied through
 * `pyodide.pyimport`. The install handler reaches for `micropip` this
 * way so the worker never builds Python source strings around
 * user-supplied package names (string interpolation into runPython is
 * the equivalent of `shell: true` on the npm side).
 */
type PyodidePyModule = {
  /**
   * RL-025 Slice C — the `install` function on the `micropip`
   * PyProxy accepts either a JS string[] (auto-converted) or a
   * Pyodide-managed Python list (`pyodide.toPy(array)`). Typed
   * loosely as `unknown` so the worker can pass the PyProxy
   * returned by `toPy` without an unsafe `as` cast.
   */
  install?: (packages: unknown) => Promise<unknown> | unknown;
  destroy?: () => void;
};

type PyodideRuntime = {
  runPythonAsync(code: string): Promise<unknown>;
  /**
   * RL-025 Slice C — load a Pyodide-shipped package into the
   * runtime. Used to bootstrap `micropip` before the first install.
   */
  loadPackage?: (
    names: string | readonly string[]
  ) => Promise<unknown>;
  /**
   * RL-025 Slice C — set of packages currently installed in the
   * runtime. Keys include both `loadPackage`-installed Pyodide
   * builtins (numpy, pandas, etc. when pre-loaded) and
   * `micropip.install`-installed wheels (which delegate to
   * `loadPackage` internally). The renderer queries this set via
   * the `dependencies:list-loaded` message so the panel can mark
   * pre-loaded packages as `'installed'` honestly.
   */
  loadedPackages?: Record<string, unknown>;
  /**
   * RL-025 Slice C — import a Python module (e.g. `micropip`). Lets
   * us call into the install path without ever building a runPython
   * source string from user-supplied package names.
   */
  pyimport?: (name: string) => PyodidePyModule;
  /**
   * RL-025 Slice C — convert a JS value to its Python equivalent
   * (Array → list, plain object → dict, etc.). `micropip.install`
   * accepts a Python list; passing a JS array directly relies on
   * Pyodide's PyProxy auto-conversion which has had version-to-
   * version regressions. Using `toPy` explicitly is defensive.
   */
  toPy?: (value: unknown) => unknown;
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
 * RL-044 Slice 2b-β-β-α — bridge `__lingua.{chart,image,html}` callbacks
 * registered on Pyodide globals. Each helper unwraps the PyProxy passed
 * from Python (dict → JS via `dict_converter: Object.fromEntries`),
 * runs the same `validate*` whitelist the JS worker uses, and posts the
 * matching `console` message shape. Accepts → `payload` array + text
 * fallback. Rejects → `richMediaRejected: { kind, reason }` flag + text
 * fallback. Mirror of `buildLinguaWorkerBridge` in `js-worker.ts`; the
 * two paths must stay in lockstep for cross-language parity.
 */
interface PyProxyLike {
  toJs?(options?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown }): unknown;
  destroy?(): void;
}

function pyProxyToJs(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as PyProxyLike).toJs === 'function') {
    let converted: unknown = null;
    let ok = false;
    try {
      converted = (value as PyProxyLike).toJs!({
        dict_converter: Object.fromEntries,
      });
      ok = true;
    } catch {
      // Conversion failed; converted stays null. Destroy still runs
      // in finally so the underlying Pyodide handle is released even
      // on the throwing path.
    } finally {
      try {
        (value as PyProxyLike).destroy?.();
      } catch {
        // Best-effort destroy; safe to swallow.
      }
    }
    return ok ? converted : null;
  }
  return value;
}

interface LinguaRichMediaBridge {
  chart: (spec: unknown) => void;
  image: (src: unknown, mime?: unknown) => void;
  html: (html: unknown) => void;
}

function buildPythonRichMediaBridge(
  runId: string
): LinguaRichMediaBridge {
  const postRejection = (
    kind: 'chart' | 'image' | 'html',
    reason: 'invalid-src' | 'size-limit' | 'validation-failed',
    fallbackText: string
  ): void => {
    ctx.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: [fallbackText],
      richMediaRejected: { kind, reason },
    });
  };

  const postPayload = (
    payload: RichOutputPayload,
    fallbackText: string
  ): void => {
    ctx.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: [fallbackText],
      payload: [payload],
    });
  };

  return {
    chart: (specProxy) => {
      const spec = pyProxyToJs(specProxy);
      const validated = validateChartSpec(spec);
      if (validated === null) {
        postRejection(
          'chart',
          'validation-failed',
          '[chart rejected: remote/named data not allowed (use data.values inline)]'
        );
        return;
      }
      postPayload({ kind: 'chart', spec: validated }, '[chart]');
    },
    image: (srcRaw, mimeRaw) => {
      const src = pyProxyToJs(srcRaw);
      const mime = pyProxyToJs(mimeRaw);
      const validatedSrc = validateImageSrc(src);
      if (validatedSrc === null) {
        postRejection(
          'image',
          'invalid-src',
          '[image rejected: src must be data:image/, blob:, or https://]'
        );
        return;
      }
      const mimeString =
        typeof mime === 'string' && mime.length > 0 ? mime : 'image/png';
      postPayload(
        { kind: 'image', src: validatedSrc, mime: mimeString },
        `[image ${mimeString}]`
      );
    },
    html: (htmlRaw) => {
      const html = pyProxyToJs(htmlRaw);
      const validated = validateHtmlPayload(html);
      if (validated === null) {
        const reason: 'size-limit' | 'validation-failed' =
          typeof html === 'string' && html.length > 0 ? 'size-limit' : 'validation-failed';
        const reasonText =
          reason === 'size-limit'
            ? '[html rejected: payload exceeds 256 KB cap]'
            : '[html rejected: expected a non-empty string]';
        postRejection('html', reason, reasonText);
        return;
      }
      postPayload({ kind: 'html', html: validated }, '[html sandboxed]');
    },
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

interface PythonPrintEntry {
  text: string;
  method: 'log' | 'error';
  payloads: RichOutputPayload[];
  /**
   * Source line number captured at print()-call time via
   * `sys._getframe`. Threads through to `ConsoleOutput.line` so the
   * renderer's inline-result pipeline (`useInlineResults`) paints
   * the arrow + payload pill next to the user's source line — the
   * same UX JS scratchpads get for `console.log`.
   */
  line?: number;
}

/**
 * RL-044 Slice 1C — post the typed per-print payloads from the Python
 * worker preamble. Each entry's joined text is split by newline so the
 * console panel keeps its "one entry per line" cadence; the rich
 * `payloads` array is attached to the FIRST line only (subsequent
 * lines are continuation text from the same print call).
 *
 * Skips entries with empty text (e.g. `print(end='')`) to mirror the
 * legacy `postBufferedOutput` filter.
 */
function postPythonPrintEntries(
  runId: string,
  entries: PythonPrintEntry[]
): void {
  for (const entry of entries) {
    // Filter on `line !== ''` (NOT `line.trim() !== ''`) so the
    // behavior matches `postBufferedOutput` exactly: a `print('   ')`
    // surfaces three spaces in both rich and text-only paths. The
    // trailing newline produced by the default `end='\n'` yields a
    // single empty segment after split, which is what we want to skip.
    const lines = entry.text.split('\n').filter((line) => line !== '');
    if (lines.length === 0) continue;
    const first = lines[0]!;
    const rest = lines.slice(1);
    const message: {
      type: 'console';
      runId: string;
      method: 'log' | 'error';
      args: string[];
      payload: RichOutputPayload[];
      line?: number;
    } = {
      type: 'console',
      runId,
      method: entry.method,
      args: [first],
      payload: entry.payloads,
    };
    if (typeof entry.line === 'number') message.line = entry.line;
    ctx.postMessage(message);
    for (const continuation of rest) {
      const continuationMessage: {
        type: 'console';
        runId: string;
        method: 'log' | 'error';
        args: string[];
        line?: number;
      } = {
        type: 'console',
        runId,
        method: entry.method,
        args: [continuation],
      };
      // Multi-line `print('a\nb')` keeps the line annotation on each
      // emitted entry so the inline pill shows up alongside both.
      if (typeof entry.line === 'number') continuationMessage.line = entry.line;
      ctx.postMessage(continuationMessage);
    }
  }
}

// RL-025 Slice C — defensive PyPI-name regex. PyPI's accepted form is
// case-insensitive: starts with a letter or digit, allows interior
// `[A-Za-z0-9._-]`, and ends in a letter or digit. Trailing `.` or
// `-` would resolve to surprising packages once PyPI's normaliser
// stripped them; we reject them up front instead. Total length cap
// matches PyPI's documented 214-char ceiling.
const PYTHON_PACKAGE_NAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,212}[a-zA-Z0-9])?$/u;

// RL-025 Slice C — micropip module cache. The PyProxy is intentionally
// kept alive for the worker's lifetime: this is a single Pyodide
// runtime per session, so re-importing on every install would only
// add latency without freeing meaningful memory. The leak is bounded
// at one PyProxy per session and is documented here so a future
// refactor doesn't accidentally clear it on each install.
//
// We cache the PROMISE rather than the resolved module so two
// `dependencies:install` messages arriving before micropip is loaded
// share a single `loadPackage('micropip')` + `pyimport('micropip')`
// ceremony instead of racing and producing two independent PyProxies.
let micropipLoadPromise: Promise<PyodidePyModule> | null = null;

async function ensureMicropip(): Promise<PyodidePyModule> {
  if (micropipLoadPromise) return micropipLoadPromise;
  micropipLoadPromise = (async () => {
    const py = (await loadPyodide()) as PyodideRuntime;
    if (
      typeof py.loadPackage !== 'function' ||
      typeof py.pyimport !== 'function'
    ) {
      throw new Error('Pyodide runtime missing loadPackage / pyimport');
    }
    await py.loadPackage('micropip');
    const mod = py.pyimport('micropip');
    if (!mod || typeof mod.install !== 'function') {
      throw new Error('Failed to load micropip (missing install)');
    }
    return mod;
  })().catch((err) => {
    // Reset on failure so a retry can re-attempt the load instead of
    // permanently caching the rejection.
    micropipLoadPromise = null;
    throw err;
  });
  return micropipLoadPromise;
}

// RL-025 Slice C — classify the error surface micropip throws when an
// install fails. Native wheels (numpy-fork, psycopg2, packages with C
// extensions Pyodide does not ship) raise a distinctive message that
// we map to the closed-enum `'unsupported-wheel'` so dashboards can
// distinguish recoverable native-wheel rejections from generic
// network errors.
function classifyMicropipError(
  message: string
): DependencyInstallFailureReason {
  const lower = message.toLowerCase();
  if (
    // Pyodide < 0.25 native-wheel rejection.
    lower.includes("can't find a pure python 3 wheel") ||
    // Pyodide >= 0.25 canonical form (note the inverted phrasing).
    lower.includes('is not a pure python 3 wheel') ||
    lower.includes('no binary distribution') ||
    lower.includes('no compatible wheel') ||
    lower.includes('requires extension build') ||
    lower.includes('no matching distribution')
  ) {
    return 'unsupported-wheel';
  }
  return 'unknown';
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
      /**
       * RL-044 Slice 1C fold E — when `false`, the worker preamble
       * skips all Python-side payload serialization. The renderer's
       * `Settings.consoleRichRenderingEnabled` toggle flows through
       * here so the runtime cost of `__lingua_console_serialize`
       * disappears entirely on hot scratchpads when the user has
       * opted out of the rich path.
       */
      richConsoleEnabled?: boolean;
      /**
       * RL-044 Sub-slice G.1 — gate the per-call
       * `__lingua_caller_line()` frame walk inside `__lingua_print`
       * and `__lingua_displayhook` so tight Python loops do not pay
       * the inspect-frame cost when the user has disabled the
       * output-source-mapping master toggle. Defaults to `true` so
       * pre-G.1 callers (and the renderer-side privacy stripping in
       * `executeTabManually.stripConsoleOutputOrigin`) keep working
       * unchanged.
       */
      sourceMappingEnabled?: boolean;
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

      // RL-044 Slice 2b-β-β-α — install the JS-backed rich-media
      // callbacks BEFORE the Python preamble runs so the `__lingua`
      // namespace can reference them. The bridge is captured per-run
      // (`runId`-bound) so a stale reply from a killed run cannot
      // tag the next run's output. Pyodide's `globals.set` is
      // re-entrant; the previous run's binding is overwritten in place
      // without leaking.
      const richMediaBridge = buildPythonRichMediaBridge(runId);
      py.globals.set('__lingua_emit_chart', richMediaBridge.chart);
      py.globals.set('__lingua_emit_image', richMediaBridge.image);
      py.globals.set('__lingua_emit_html', richMediaBridge.html);

      await py.runPythonAsync(`
import io
import sys
import json as __lingua_json
import builtins as __lingua_builtins
import datetime as __lingua_datetime
import math as __lingua_math
__lingua_stdout = io.StringIO()
__lingua_stderr = io.StringIO()
__lingua_prev_stdout = sys.stdout
__lingua_prev_stderr = sys.stderr
sys.stdout = __lingua_stdout
sys.stderr = __lingua_stderr

# RL-044 Slice 1C — rich console payload pipeline.
# The user's namespace gets a wrapped 'print' that captures (text, [payload_per_arg])
# into __lingua_print_entries. Libraries that reach for the bare builtin via
# __lingua_builtins.print still get the unpatched function — only the user-code
# global 'print' is overridden. The serializer is pure stdlib (json + datetime +
# math) so no extra Pyodide packages are loaded.

__lingua_rich_console_enabled = ${msg.richConsoleEnabled === false ? 'False' : 'True'}
# RL-044 Sub-slice G.1 baked flag mirroring the __lingua_print_entries_cap pattern.
# When False, __lingua_print and __lingua_displayhook skip the per-call
# __lingua_caller_line frame walk so a tight Python loop pays no
# inspect-frame CPU when the user has disabled the master toggle.
# Privacy-side, executeTabManually.stripConsoleOutputOrigin is defense in
# depth; this flag is the actual CPU short-circuit.
__lingua_console_source_mapping_enabled = ${msg.sourceMappingEnabled === false ? 'False' : 'True'}
__lingua_print_entries = []
__lingua_print_entries_cap = 5000


class __LinguaCaptureStream(io.StringIO):
    def __init__(self, method):
        super().__init__()
        self._lingua_method = method

    def write(self, text):
        written = super().write(text)
        entries = globals().get("__lingua_print_entries")
        rich_enabled = globals().get("__lingua_rich_console_enabled")
        cap = globals().get("__lingua_print_entries_cap", 0)
        if rich_enabled and isinstance(entries, list) and text and len(entries) < cap:
            entries.append({"text": str(text), "method": self._lingua_method, "payloads": []})
        return written


# Rich mode uses the ordered print-entry stream as the console source.
# These capture streams preserve direct sys.stdout.write/sys.stderr.write
# calls as text-only entries so they are not dropped when a run also
# contains rich print() payloads. Rich print()/displayhook paths skip
# writing to these streams to avoid duplicate console rows.
__lingua_stdout = __LinguaCaptureStream("log")
__lingua_stderr = __LinguaCaptureStream("error")
sys.stdout = __lingua_stdout
sys.stderr = __lingua_stderr

_LINGUA_MAX_TOP_LEVEL = 200
_LINGUA_MAX_PER_CONTAINER = 100
_LINGUA_MAX_TABLE_ROWS = 200
_LINGUA_MAX_TABLE_COLUMNS = 16
_LINGUA_PRIMITIVE_REPR_CAP = 256


def __lingua_repr_safe(value):
    try:
        text = repr(value)
    except Exception as exc:  # noqa: BLE001 — defensive against __repr__ raising
        return "<repr error: " + type(exc).__name__ + ">"
    if len(text) > _LINGUA_PRIMITIVE_REPR_CAP:
        return text[: _LINGUA_PRIMITIVE_REPR_CAP] + "\\u2026"
    return text


def __lingua_primitive_payload(value):
    if value is None:
        return {"kind": "primitive", "type": "none", "repr": "None"}
    if isinstance(value, bool):
        return {"kind": "primitive", "type": "boolean", "repr": "True" if value else "False"}
    if isinstance(value, int):
        return {"kind": "primitive", "type": "number", "repr": __lingua_repr_safe(value)}
    if isinstance(value, float):
        if __lingua_math.isnan(value):
            return {"kind": "primitive", "type": "number", "repr": "nan"}
        if __lingua_math.isinf(value):
            return {"kind": "primitive", "type": "number", "repr": "inf" if value > 0 else "-inf"}
        return {"kind": "primitive", "type": "number", "repr": __lingua_repr_safe(value)}
    if isinstance(value, str):
        return {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value)}
    return None


def __lingua_scope_value(value, depth):
    primitive = __lingua_primitive_payload(value)
    if primitive is not None:
        return primitive
    if callable(value) and not isinstance(value, type):
        name = getattr(value, "__name__", None) or type(value).__name__
        return {"kind": "function", "name": str(name)}
    if depth <= 0:
        return {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value)}
    if isinstance(value, dict):
        preview_type = type(value).__name__ if type(value) is not dict else "dict"
        entries = []
        for idx, (key, item) in enumerate(value.items()):
            if idx >= _LINGUA_MAX_PER_CONTAINER:
                break
            entries.append({"key": __lingua_repr_safe(key), "value": __lingua_scope_value(item, depth - 1)})
        truncated = max(0, len(value) - len(entries))
        out = {"kind": "object", "previewType": preview_type, "entries": entries}
        if truncated:
            out["truncatedCount"] = truncated
        return out
    if isinstance(value, (list, tuple)):
        entries = []
        for idx, item in enumerate(value):
            if idx >= _LINGUA_MAX_PER_CONTAINER:
                break
            entries.append({"index": idx, "value": __lingua_scope_value(item, depth - 1)})
        truncated = max(0, len(value) - len(entries))
        out = {"kind": "array", "length": len(value), "entries": entries}
        if truncated:
            out["truncatedCount"] = truncated
        return out
    if isinstance(value, (set, frozenset)):
        entries = []
        for idx, item in enumerate(value):
            if idx >= _LINGUA_MAX_PER_CONTAINER:
                break
            entries.append(__lingua_scope_value(item, depth - 1))
        truncated = max(0, len(value) - len(entries))
        out = {"kind": "set", "size": len(value), "entries": entries}
        if truncated:
            out["truncatedCount"] = truncated
        return out
    if isinstance(value, __lingua_datetime.datetime):
        try:
            iso = value.isoformat()
        except Exception:  # noqa: BLE001
            iso = "Invalid Date"
        return {"kind": "date", "iso": iso}
    return None


def __lingua_dataclass_payload(value, depth):
    fields = getattr(value, "__dataclass_fields__", None)
    if not isinstance(fields, dict) or not fields:
        return None
    entries = []
    for name in fields.keys():
        try:
            child = getattr(value, name)
        except Exception as exc:  # noqa: BLE001
            child = "<attr error: " + type(exc).__name__ + ">"
        entries.append({"key": str(name), "value": __lingua_scope_value(child, depth - 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(child)}})
    return {"kind": "object", "previewType": type(value).__name__, "entries": entries}


def __lingua_detect_auto_table(value):
    if not isinstance(value, (list, tuple)) or len(value) == 0:
        return None
    column_set = []
    seen = {}
    for item in value:
        if not isinstance(item, dict):
            return None
        for key in item.keys():
            if not isinstance(key, str):
                return None
            if key not in seen:
                seen[key] = True
                column_set.append(key)
                if len(column_set) > _LINGUA_MAX_TABLE_COLUMNS:
                    return None
    if not column_set:
        return None
    slice_count = min(len(value), _LINGUA_MAX_TABLE_ROWS)
    rows = []
    for row_idx in range(slice_count):
        row = value[row_idx]
        cells = []
        for col in column_set:
            if col in row:
                cells.append(__lingua_scope_value(row[col], 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(row[col])})
            else:
                cells.append({"kind": "primitive", "type": "undefined", "repr": "None"})
        rows.append(cells)
    truncated = max(0, len(value) - slice_count)
    out = {"kind": "table", "columns": column_set, "rows": rows}
    if truncated:
        out["truncatedRowCount"] = truncated
    return out


def __lingua_force_table(value):
    auto = __lingua_detect_auto_table(value)
    if auto is not None:
        return auto
    if isinstance(value, (list, tuple)):
        slice_count = min(len(value), _LINGUA_MAX_TABLE_ROWS)
        rows = [[__lingua_scope_value(value[idx], 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value[idx])}] for idx in range(slice_count)]
        out = {"kind": "table", "columns": ["value"], "rows": rows}
        truncated = max(0, len(value) - slice_count)
        if truncated:
            out["truncatedRowCount"] = truncated
        return out
    if isinstance(value, dict):
        keys = list(value.keys())[:_LINGUA_MAX_TABLE_COLUMNS]
        if not keys:
            return {"kind": "table", "columns": [], "rows": []}
        row = [__lingua_scope_value(value[k], 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value[k])} for k in keys]
        return {"kind": "table", "columns": [str(k) for k in keys], "rows": [row]}
    return {"kind": "table", "columns": ["value"], "rows": [[__lingua_scope_value(value, 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value)}]]}


def __lingua_console_serialize(value, force_table=False):
    # Fold E — bypass entirely when rich rendering is off; saves cycles
    # on hot Python loops by short-circuiting before the type walk.
    if not __lingua_rich_console_enabled:
        return None
    if force_table:
        return __lingua_force_table(value)
    # Fold F — Python exception → error payload.
    if isinstance(value, BaseException):
        return {"kind": "error", "message": __lingua_repr_safe(value)}
    auto_table = __lingua_detect_auto_table(value)
    if auto_table is not None:
        return auto_table
    scope = __lingua_scope_value(value, 1)
    if scope is not None:
        return scope
    dataclass_payload = __lingua_dataclass_payload(value, 1)
    if dataclass_payload is not None:
        return dataclass_payload
    return {"kind": "rawText", "text": __lingua_repr_safe(value)}


__lingua_builtins_print = __lingua_builtins.print


def __lingua_caller_line():
    # RL-044 Slice 1C follow-up — surface the user-source line number
    # so each print() entry threads through ConsoleOutput.line and
    # paints an inline pill via useInlineResults (same JS behavior as
    # console.log). Walk frames upward until we exit the lingua-owned
    # helpers; user code runs in a Pyodide module compiled from a
    # string so f_lineno maps directly to the source line.
    try:
        frame = sys._getframe(1)
        while frame is not None:
            name = frame.f_code.co_name
            if name not in ("__lingua_print", "__lingua_displayhook", "__lingua_caller_line"):
                return frame.f_lineno
            frame = frame.f_back
    except Exception:  # noqa: BLE001 — best-effort
        pass
    return None


def __lingua_print(*args, sep=None, end=None, file=None, flush=False):
    target_is_console = file is None or file is sys.stdout or file is sys.stderr
    if not (__lingua_rich_console_enabled and target_is_console):
        __lingua_builtins_print(*args, sep=sep, end=end, file=file, flush=flush)
        return

    sep_actual = " " if sep is None else sep
    end_actual = "\\n" if end is None else end
    if not isinstance(sep_actual, str) or not isinstance(end_actual, str):
        # Delegate invalid sep/end handling to CPython's builtin print
        # so user-visible TypeError semantics stay stock.
        __lingua_builtins_print(*args, sep=sep, end=end, file=file, flush=flush)
        return

    text = sep_actual.join(str(arg) for arg in args) + end_actual
    if len(__lingua_print_entries) >= __lingua_print_entries_cap:
        return
    method = "error" if file is sys.stderr else "log"
    # Fold C — per-arg payload capture: each positional arg becomes its
    # own payload entry aligned with the joined text.
    payloads = []
    for arg in args:
        payload = __lingua_console_serialize(arg)
        if payload is None:
            payload = {"kind": "rawText", "text": __lingua_repr_safe(arg)}
        payloads.append(payload)
    entry = {"text": text, "method": method, "payloads": payloads}
    # RL-044 Sub-slice G.1 — skip the inspect-frame walk when the
    # master toggle is OFF. Privacy-side, the renderer strips origin
    # at executeTabManually as defense in depth; this gate is the
    # actual CPU short-circuit for tight print loops.
    if __lingua_console_source_mapping_enabled:
        line = __lingua_caller_line()
        if line is not None:
            entry["line"] = line
    __lingua_print_entries.append(entry)


# Override 'print' in the user namespace (globals) — leaves
# __lingua_builtins.print intact for any library that reaches for the
# original.
globals()["print"] = __lingua_print


def __lingua_displayhook(value):
    # Fold A — REPL-style top-level expression capture. Pyodide's
    # default displayhook prints repr() for non-None expression
    # results. We mirror that text output AND capture the value as a
    # rich payload, so a scratchpad cell ending in 'users' (no print
    # needed) renders with the same object/table chip as print(users).
    if value is None:
        return
    __lingua_builtins._ = value
    text = __lingua_repr_safe(value) + "\\n"
    if not __lingua_rich_console_enabled:
        sys.stdout.write(text)
        return
    if len(__lingua_print_entries) >= __lingua_print_entries_cap:
        return
    payload = __lingua_console_serialize(value)
    if payload is None:
        payload = {"kind": "rawText", "text": __lingua_repr_safe(value)}
    entry = {"text": text, "method": "log", "payloads": [payload]}
    # RL-044 Sub-slice G.1 — same gate as __lingua_print. The
    # displayhook fires once per top-level expression so the CPU win
    # is smaller than in tight print loops, but the consistency
    # matters: both surfaces have to honor the master toggle so the
    # privacy + perf posture is symmetric.
    if __lingua_console_source_mapping_enabled:
        line = __lingua_caller_line()
        if line is not None:
            entry["line"] = line
    __lingua_print_entries.append(entry)


sys.displayhook = __lingua_displayhook


__lingua_magic_results = []
__lingua_rich_media_directives = ("chart", "image", "html")
def __mc(line, expr_fn, directive=None):
    try:
        val = expr_fn()
        # RL-044 Slice 2b-β-β-α — rich-media directives need JSON-encoded
        # values because the runner side calls
        # \`payloadForRichMediaMagicDirective\` which delegates to
        # \`tryParseJsonForPayload\`. Python's \`repr(dict)\` produces
        # single-quoted strings that JSON rejects; using \`json.dumps\`
        # for these directives makes the cross-language contract
        # symmetric with the JS worker (which already JSON-stringifies).
        # Other directives keep \`repr()\` to preserve the legacy debug
        # surface for arrow comments.
        if directive in __lingua_rich_media_directives:
            try:
                value_text = __lingua_json.dumps(val)
            except Exception:  # noqa: BLE001 — non-JSON values fall back to repr
                value_text = repr(val)
        else:
            value_text = repr(val)
        record = {"line": line, "value": value_text}
        # Fold D — magic-comment '#=> table' upgrade. When the
        # directive tags 'table', also include a forced-table payload
        # so the renderer can dispatch to the rich table widget.
        if directive == "table" and __lingua_rich_console_enabled:
            try:
                record["payload"] = __lingua_console_serialize(val, force_table=True)
            except Exception:  # noqa: BLE001 — never let payload errors hide the arrow value
                pass
        __lingua_magic_results.append(record)
        return val
    except Exception as e:
        __lingua_magic_results.append({"line": line, "value": str(e)})
        return None

# RL-044 Slice 2b-β-β-α — \`__lingua\` namespace mirror of the JS
# \`lingua.{chart,image,html}\` bridge. Wrapping the three helpers in a
# types.SimpleNamespace keeps the user API ergonomic across languages:
#     // JS:       lingua.chart({ ... })
#     // Python:   __lingua.chart({ ... })
# Validation lives in JS (shared shared/richOutput.ts validators) so
# the rules stay single-sourced; these Python shims just forward.
import types as __lingua_types

def __lingua_chart_helper(spec):
    fn = globals().get("__lingua_emit_chart")
    if fn is None:
        return None
    fn(spec)

def __lingua_image_helper(src, mime=None):
    fn = globals().get("__lingua_emit_image")
    if fn is None:
        return None
    fn(src, mime)

def __lingua_html_helper(html):
    fn = globals().get("__lingua_emit_html")
    if fn is None:
        return None
    fn(html)

__lingua = __lingua_types.SimpleNamespace(
    chart=__lingua_chart_helper,
    image=__lingua_image_helper,
    html=__lingua_html_helper,
)
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
# RL-044 Slice 1C — guarantee sys.stdout / sys.stderr / sys.displayhook
# get restored even if the JSON dump itself raises. The Pyodide worker
# is persistent, so a stranded __lingua_displayhook reference from a
# previous run would re-fire against a stale __lingua_print_entries
# list on the next execute. The cleanup runs in a finally so the
# next run always starts on the stock hooks.
try:
    _lingua_state = __lingua_json.dumps({
        "stdout": __lingua_stdout.getvalue(),
        "stderr": __lingua_stderr.getvalue(),
        "magic": __lingua_magic_results,
        "print_entries": __lingua_print_entries,
    })
except Exception as _lingua_dump_err:
    _lingua_state = __lingua_json.dumps({
        "stdout": __lingua_stdout.getvalue(),
        "stderr": __lingua_stderr.getvalue() + "\\n[lingua: dump failed: " + repr(_lingua_dump_err) + "]",
        "magic": [],
        "print_entries": [],
    })
finally:
    sys.stdout = __lingua_prev_stdout
    sys.stderr = __lingua_prev_stderr
    sys.displayhook = sys.__displayhook__
    __lingua_magic_results = []
    __lingua_print_entries = []
_lingua_state
      `);

      const streams =
        typeof streamState === 'string'
          ? (JSON.parse(streamState) as {
              stdout: string;
              stderr: string;
              magic?: Array<{ line: number; value: string; payload?: RichOutputPayload }>;
              print_entries?: PythonPrintEntry[];
            })
          : { stdout: '', stderr: '' };

      // RL-044 Slice 1C — when the Python preamble produced typed
      // print entries (the common case once the override is in place),
      // post those instead of splitting the buffered stdout. The
      // buffered text path remains the fallback when print_entries is
      // empty (e.g. the user opted out via Settings, or stdout was
      // written via sys.stdout.write directly bypassing the override).
      const printEntries = Array.isArray(streams.print_entries)
        ? streams.print_entries
        : [];
      if (printEntries.length > 0) {
        postPythonPrintEntries(runId, printEntries);
      } else {
        postBufferedOutput(runId, 'log', streams.stdout);
      }
      postBufferedOutput(runId, 'error', streams.stderr);

      // Send magic comment results
      if (streams.magic) {
        for (const entry of streams.magic) {
          // RL-044 Slice 1C fold D — `#=> table` directive surfaces a
          // forced-table payload alongside the legacy `value` text.
          // Renderers that don't consume the payload still see the
          // text fallback unchanged.
          const magicMessage: {
            type: 'magic-comment';
            runId: string;
            line: number;
            value: string;
            payload?: RichOutputPayload;
          } = {
            type: 'magic-comment',
            runId,
            line: entry.line,
            value: truncate(entry.value, marker),
          };
          if (entry.payload) magicMessage.payload = entry.payload;
          ctx.postMessage(magicMessage);
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
        const tracebackText = streams.stderr || errorText;
        // RL-044 Slice 2b-α — structured stack frames for the
        // renderer's clickable-stack surface. Best-effort parse;
        // unparseable lines stay as text-only frames so they render
        // as non-clickable spans.
        const frames = parsePythonTraceback(tracebackText);
        ctx.postMessage({
          type: 'error',
          runId,
          error: {
            message: parsed.message,
            line: parsed.line,
            stack: tracebackText,
            ...(frames.length > 0 ? { frames } : {}),
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
      // RL-044 Slice 2b-α — Sub-slice F parity. The inner-streams
      // error path (above) already parses Pyodide's stderr traceback;
      // this outer-catch fires when Pyodide itself throws BEFORE the
      // user code's traceback reaches stderr (SyntaxError on compile,
      // import-time failures, etc.). Pyodide formats the Python
      // traceback into `err.message`, so the same parser produces the
      // same structured frames here. Omitting `frames` would have
      // produced a silently text-only error for these paths.
      const frames = parsePythonTraceback(errorText);

      ctx.postMessage({
        type: 'error',
        runId,
        error: {
          message: parsed.message,
          line: parsed.line,
          stack: errorText,
          ...(frames.length > 0 ? { frames } : {}),
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

  // ─────────────────────────────────────────────────────────────
  // RL-025 Slice C — Pyodide dependency-management bridge.
  // ─────────────────────────────────────────────────────────────

  if (msg.type === 'dependencies:list-loaded') {
    const { requestId } = msg as { requestId: string };
    try {
      const py = (await loadPyodide()) as PyodideRuntime;
      const loaded = py.loadedPackages
        ? Object.keys(py.loadedPackages)
        : [];
      ctx.postMessage({
        type: 'dependencies:list-loaded:reply',
        requestId,
        packages: loaded,
      });
    } catch {
      // Pyodide boot failed — caller falls back to `'detected'` for
      // every name, preserving Slice A's honest signal.
      ctx.postMessage({
        type: 'dependencies:list-loaded:reply',
        requestId,
        packages: [],
      });
    }
    return;
  }

  if (msg.type === 'dependencies:install') {
    const { runId, specifiers } = msg as {
      runId: string;
      specifiers: readonly string[];
    };
    // Defensive validation: even though the renderer-side Slice A
    // detector returns clean PyPI names, the worker re-validates so
    // a compromised renderer cannot smuggle injection text into
    // `micropip.install`. Reviewer fix — track REJECTED names too so
    // the final statuses map covers every input. Otherwise the
    // renderer would leave those rows stuck in `'installing'`
    // because `endInstall` only flips names it sees in
    // `perNameStatus`.
    const seen = new Set<string>();
    const safeNames: string[] = [];
    const rejectedNames: string[] = [];
    for (const raw of specifiers) {
      if (typeof raw !== 'string') continue;
      if (!PYTHON_PACKAGE_NAME_RE.test(raw)) {
        rejectedNames.push(raw);
        continue;
      }
      if (seen.has(raw)) continue;
      seen.add(raw);
      safeNames.push(raw);
    }
    if (safeNames.length === 0) {
      const statuses: Record<
        string,
        'installed' | 'failed' | 'cancelled' | 'skipped-preflight'
      > = {};
      for (const name of rejectedNames) statuses[name] = 'failed';
      ctx.postMessage({
        type: 'dependencies:install:done',
        runId,
        statuses,
        outcome: 'failed' as DependencyInstallOutcome,
        failureReason: 'invalid-specifier' as DependencyInstallFailureReason,
      });
      return;
    }

    try {
      ctx.postMessage({
        type: 'dependencies:install:log',
        runId,
        stream: 'stdout',
        chunk: 'Loading Python runtime...\n',
      });
      const micropip = await ensureMicropip();
      ctx.postMessage({
        type: 'dependencies:install:log',
        runId,
        stream: 'stdout',
        chunk: `Installing ${safeNames.join(', ')} via micropip...\n`,
      });
      // Reviewer fix — pass a Python list (not the raw JS array) to
      // `micropip.install`. Recent Pyodide versions still accept JS
      // arrays via PyProxy auto-conversion, but the conversion has
      // historically been fragile across releases (a passed-through
      // JS array can coerce to `str([...])`). Using `pyodide.toPy`
      // is the documented defensive path. Reviewer fix v2 — wrap in
      // try/finally so the PyProxy returned by `toPy` is destroyed
      // even if `micropip.install` throws (avoids one PyProxy leak
      // per install).
      const py = (await loadPyodide()) as PyodideRuntime;
      const argument =
        typeof py.toPy === 'function' ? py.toPy(safeNames) : safeNames;
      try {
        await Promise.resolve(micropip.install!(argument));
      } finally {
        if (
          argument &&
          argument !== safeNames &&
          typeof (argument as PyProxyLike).destroy === 'function'
        ) {
          try {
            (argument as PyProxyLike).destroy!();
          } catch {
            // Best-effort destroy; the PyProxy may already be gone if
            // Pyodide recycled it internally.
          }
        }
      }
      const statuses: Record<
        string,
        'installed' | 'failed' | 'cancelled' | 'skipped-preflight'
      > = {};
      for (const name of safeNames) statuses[name] = 'installed';
      for (const name of rejectedNames) statuses[name] = 'failed';
      // RL-025 Slice C reviewer fix — when SOME names were rejected
      // (regex-invalid) but the rest installed cleanly, surface a
      // `partial` outcome so the renderer can see "some succeeded,
      // some failed". The dominant failure reason is the regex
      // rejection.
      const outcome: DependencyInstallOutcome =
        rejectedNames.length > 0 ? 'partial' : 'success';
      const failureReason: DependencyInstallFailureReason | null =
        rejectedNames.length > 0 ? 'invalid-specifier' : null;
      ctx.postMessage({
        type: 'dependencies:install:done',
        runId,
        statuses,
        outcome,
        failureReason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason: DependencyInstallFailureReason =
        classifyMicropipError(message);
      ctx.postMessage({
        type: 'dependencies:install:log',
        runId,
        stream: 'stderr',
        chunk: `${message}\n`,
      });
      const statuses: Record<
        string,
        'installed' | 'failed' | 'cancelled' | 'skipped-preflight'
      > = {};
      for (const name of safeNames) statuses[name] = 'failed';
      for (const name of rejectedNames) statuses[name] = 'failed';
      ctx.postMessage({
        type: 'dependencies:install:done',
        runId,
        statuses,
        outcome: 'failed' as DependencyInstallOutcome,
        failureReason: reason,
      });
    }
    return;
  }
});

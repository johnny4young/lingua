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
import type { PyodideRuntime } from './python-worker-runtime';

const ctx = self as unknown as Worker;
let pythonBootGlobals: ReadonlySet<string> | null = null;

export const PYTHON_WORKER_FALLBACK_RESULT_TRUNCATION_MARKER = '[result truncated]';

export function truncatePythonWorkerValue(value: string, marker: string): string {
  return truncateSerialized(value, marker);
}

/** Parse Python traceback to extract line/column */
export function parsePythonWorkerError(errorText: string): { line?: number; message: string } {
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
 * implementation — bridge `__lingua.{chart,image,html}` callbacks
 * registered on Pyodide globals. Each helper unwraps the PyProxy passed
 * from Python (dict → JS via `dict_converter: Object.fromEntries`),
 * runs the same `validate*` whitelist the JS worker uses, and posts the
 * matching `console` message shape. Accepts → `payload` array + text
 * fallback. Rejects → `richMediaRejected: { kind, reason }` flag + text
 * fallback. Mirror of `buildLinguaWorkerBridge` in `js-worker.ts`; the
 * two paths must stay in lockstep for cross-language parity.
 */
export interface PyProxyLike {
  toJs?(options?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown }): unknown;
  destroy?(): void;
}

export function pythonProxyToJs(value: unknown): unknown {
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

export interface PythonRichMediaBridge {
  chart: (spec: unknown) => void;
  image: (src: unknown, mime?: unknown) => void;
  html: (html: unknown) => void;
}

export function buildPythonRichMediaBridge(runId: string): PythonRichMediaBridge {
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

  const postPayload = (payload: RichOutputPayload, fallbackText: string): void => {
    ctx.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: [fallbackText],
      payload: [payload],
    });
  };

  return {
    chart: specProxy => {
      const spec = pythonProxyToJs(specProxy);
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
      const src = pythonProxyToJs(srcRaw);
      const mime = pythonProxyToJs(mimeRaw);
      const validatedSrc = validateImageSrc(src);
      if (validatedSrc === null) {
        postRejection(
          'image',
          'invalid-src',
          '[image rejected: src must be data:image/, blob:, or https://]'
        );
        return;
      }
      const mimeString = typeof mime === 'string' && mime.length > 0 ? mime : 'image/png';
      postPayload({ kind: 'image', src: validatedSrc, mime: mimeString }, `[image ${mimeString}]`);
    },
    html: htmlRaw => {
      const html = pythonProxyToJs(htmlRaw);
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
 * implementation — Python-side scope capture.
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

export async function primePythonBootGlobalsIfNeeded(py: PyodideRuntime): Promise<void> {
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

export async function capturePythonScope(
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
  const internalSymbolsJson = JSON.stringify(Array.from(INTERNAL_PYTHON_SYMBOLS));
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
    ? parsed.variables.filter(
        v => typeof v?.name === 'string' && coerceScopeValue(v.value) !== null
      )
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

export function postPythonBufferedOutput(
  runId: string,
  method: 'log' | 'error',
  text: string
): void {
  for (const line of text.split('\n').filter(entry => entry.trim() !== '')) {
    ctx.postMessage({ type: 'console', runId, method, args: [line] });
  }
}

export interface PythonPrintEntry {
  text: string;
  method: 'log' | 'error';
  payloads: RichOutputPayload[];
  /**
   * Source line number captured at print()-call time via
   * `sys._getframe`. Threads through to `ConsoleOutput.line` so the
   * renderer's inline-result pipeline (`<InlineResultWidgets>`) paints
   * the arrow + payload pill next to the user's source line — the
   * same UX JS scratchpads get for `console.log`.
   */
  line?: number;
}

/**
 * implementation — post the typed per-print payloads from the Python
 * worker preamble. Each entry's joined text is split by newline so the
 * console panel keeps its "one entry per line" cadence; the rich
 * `payloads` array is attached to the FIRST line only (subsequent
 * lines are continuation text from the same print call).
 *
 * Skips entries with empty text (e.g. `print(end='')`) to mirror the
 * legacy `postBufferedOutput` filter.
 */
export function postPythonPrintEntries(runId: string, entries: PythonPrintEntry[]): void {
  for (const entry of entries) {
    // Filter on `line !== ''` (NOT `line.trim() !== ''`) so the
    // behavior matches `postBufferedOutput` exactly: a `print('   ')`
    // surfaces three spaces in both rich and text-only paths. The
    // trailing newline produced by the default `end='\n'` yields a
    // single empty segment after split, which is what we want to skip.
    const lines = entry.text.split('\n').filter(line => line !== '');
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

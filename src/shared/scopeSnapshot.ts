/**
 * RL-020 Slice 9 — shared variable-inspector primitives.
 *
 * Both the JS worker, the Python worker, and the renderer talk to the
 * same `ScopeSnapshot` shape so a regression on one side surfaces
 * immediately in the other side's tests.
 *
 * Design intent:
 *   - Structural, not pre-stringified. The renderer can expand
 *     objects / arrays without re-running user code.
 *   - 1-level expansion is the base scope; recursive expansion
 *     (fold E) walks deeper via the `entries[].value` recursion.
 *     The walker is capped by `maxDepth` so a self-referential
 *     graph terminates.
 *   - Payload caps (`MAX_TOP_LEVEL_VARS`, `MAX_OBJECT_ENTRIES`,
 *     `MAX_ARRAY_ENTRIES`) bound the postMessage cost.
 *   - Internal symbols (`__mc`, `__lingua_*`, `_LINGUA_*`,
 *     `_lingua_*`) are filtered at the worker source — they
 *     never cross the message boundary.
 *
 * Both workers capture a `BOOT_TIME_GLOBALS` snapshot at module
 * load and subtract it from the post-execute scope. That makes the
 * filter resilient to language-runtime updates that add new
 * globals: any name present at boot is filtered out, so only
 * user-declared bindings survive.
 */

export type ScopeValuePrimitiveType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'symbol'
  | 'bigint';

export interface ScopeValuePrimitive {
  kind: 'primitive';
  type: ScopeValuePrimitiveType;
  /** Human-readable representation. JSON-safe; truncated to the runner's marker. */
  repr: string;
}

export interface ScopeValueFunction {
  kind: 'function';
  name: string;
}

export interface ScopeValueObject {
  kind: 'object';
  /**
   * Free-form type label. JS uses constructor names (`Object`,
   * `Date`, `Map`, ...); Python uses `type(value).__name__`
   * (`dict`, `set`, ...).
   */
  previewType: string;
  entries: Array<{ key: string; value: ScopeValue }>;
  /** Number of entries elided past `MAX_OBJECT_ENTRIES`. */
  truncatedCount?: number;
}

export interface ScopeValueArray {
  kind: 'array';
  length: number;
  entries: Array<{ index: number; value: ScopeValue }>;
  truncatedCount?: number;
}

export interface ScopeValueError {
  kind: 'error';
  message: string;
  /**
   * RL-044 Slice 2a — Sub-slice F. Optional structured stack frames
   * for the renderer to paint as clickable rows. Parsed worker-side
   * by `parseJsErrorStack` / `parsePythonTraceback` from
   * `src/shared/errorStack.ts`. Absent on every call site that hasn't
   * adopted the parser yet — additive, never breaking.
   */
  stack?: import('./errorStack').ClickableStackFrame[];
}

export type ScopeValue =
  | ScopeValuePrimitive
  | ScopeValueFunction
  | ScopeValueObject
  | ScopeValueArray
  | ScopeValueError;

export interface ScopeVariable {
  name: string;
  value: ScopeValue;
}

export interface ScopeSnapshot {
  /** Language id (`javascript` / `typescript` / `python`). */
  language: string;
  /** Epoch ms; renderer renders relative-time strings off this. */
  capturedAt: number;
  variables: ScopeVariable[];
  /** Number of variables elided past `MAX_TOP_LEVEL_VARS`. */
  truncatedCount?: number;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * Top-level user-declared variables surfaced per snapshot. Anything
 * beyond is summarized in `truncatedCount`. 200 is generous — REPL
 * scratch sessions rarely declare more than a few dozen.
 */
export const MAX_TOP_LEVEL_VARS = 200;

/**
 * Entries per object inspected. Past this, `truncatedCount` records
 * how many keys were elided.
 */
export const MAX_OBJECT_ENTRIES = 100;

/**
 * Array entries per array inspected.
 */
export const MAX_ARRAY_ENTRIES = 100;

/**
 * Maximum recursion depth for the worker's `serializeScopeValue`.
 * The default base-scope value is `1`; fold E bumps to `4`. Deeper
 * than that and the panel becomes noise on a small screen — users
 * who want unbounded depth should reach for the debugger pause UI.
 */
export const DEFAULT_SCOPE_DEPTH = 1;
export const MAX_SCOPE_DEPTH = 4;

/**
 * Total serialized payload size cap. If the worker's running tally
 * exceeds this, it emits a snapshot with an empty `variables` array
 * and a `truncatedCount` equal to the original variable count so the
 * panel can render a "too large to capture" banner.
 */
export const MAX_SNAPSHOT_PAYLOAD_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Internal symbol filters
// ---------------------------------------------------------------------------

/**
 * Slice 9 — exact-match filter for JS worker globals that are
 * always non-user (the worker's helpers, the runner's bridge
 * functions, debugger frame helpers, stdin helpers).
 *
 * NOTE: the worker also subtracts a `BOOT_TIME_GLOBALS` set
 * captured at module load. This list is the belt to that snapshot's
 * suspenders — if a future helper is injected AFTER boot but
 * before user code (e.g. via the future plugin host), it MUST land
 * here too.
 */
export const INTERNAL_JS_SYMBOLS: ReadonlySet<string> = new Set([
  '__mc',
  '__lingua_dbg_yield',
  '__lingua_dbg_frame',
  '__lingua_dbg_pop',
  // Stdin helpers installed dynamically before user code runs (Slice 6).
  'prompt',
  'readline',
  // Console proxy capture target — never user-relevant.
  'originalConsole',
]);

/**
 * Python worker's known internal symbols. Captured names from the
 * Pyodide worker bootstrap snippet.
 */
export const INTERNAL_PYTHON_SYMBOLS: ReadonlySet<string> = new Set([
  '__lingua_json',
  '__lingua_stdout',
  '__lingua_stderr',
  '__lingua_prev_stdout',
  '__lingua_prev_stderr',
  '__lingua_magic_results',
  '__mc',
  '_LINGUA_USER_ENV',
  '_LINGUA_PREV_ENV_KEYS',
  // Convenience names Pyodide injects but that aren't user globals.
  'pyodide',
  '_pyodide',
]);

// ---------------------------------------------------------------------------
// Bucket helpers (telemetry)
// ---------------------------------------------------------------------------

/**
 * Closed enum of buckets surfaced via the
 * `runtime.variable_inspector_opened` telemetry event. The buckets
 * mirror the existing `countBucket` allowlist on
 * `runtime.auto_log_emitted`.
 */
export const VARIABLE_COUNT_BUCKETS = ['0', '1-5', '6-20', '21-50', '51+'] as const;
export type VariableCountBucket = (typeof VARIABLE_COUNT_BUCKETS)[number];

export function bucketVariableCount(count: number): VariableCountBucket {
  if (count <= 0) return '0';
  if (count <= 5) return '1-5';
  if (count <= 20) return '6-20';
  if (count <= 50) return '21-50';
  return '51+';
}

// ---------------------------------------------------------------------------
// Worker-side serializer
// ---------------------------------------------------------------------------

export interface SerializeScopeValueOptions {
  /**
   * Truncation marker used when a long string is shortened. Workers
   * pass the same marker their `serialize()` helper uses so the panel
   * can render a consistent ellipsis.
   */
  truncate: (input: string) => string;
  /**
   * Maximum recursion depth. Defaults to `DEFAULT_SCOPE_DEPTH` (1)
   * for the base scope; fold E bumps to `MAX_SCOPE_DEPTH` (4).
   */
  maxDepth?: number;
  /**
   * Per-object entry cap. Defaults to `MAX_OBJECT_ENTRIES`.
   */
  maxObjectEntries?: number;
  /**
   * Per-array entry cap. Defaults to `MAX_ARRAY_ENTRIES`.
   */
  maxArrayEntries?: number;
}

const PRIMITIVE_REPR_MAX = 200;

function clampPrimitiveRepr(input: string, truncate: (s: string) => string): string {
  if (input.length <= PRIMITIVE_REPR_MAX) return input;
  return truncate(input.slice(0, PRIMITIVE_REPR_MAX));
}

/**
 * Recursive serializer for the JS worker. Walks `value` `maxDepth`
 * levels deep; at the leaf, primitives stay primitives and
 * everything else collapses to a single-line `repr`.
 *
 * Circular references are detected via a `seen` WeakSet and emit
 * `kind: 'error'` with `message: 'Circular reference'`.
 */
export function serializeScopeValue(
  value: unknown,
  options: SerializeScopeValueOptions
): ScopeValue {
  const maxDepth = clampDepth(options.maxDepth ?? DEFAULT_SCOPE_DEPTH);
  const maxObjectEntries = options.maxObjectEntries ?? MAX_OBJECT_ENTRIES;
  const maxArrayEntries = options.maxArrayEntries ?? MAX_ARRAY_ENTRIES;
  const seen = new WeakSet<object>();
  return walk(value, 0);

  function walk(input: unknown, depth: number): ScopeValue {
    if (input === undefined) {
      return { kind: 'primitive', type: 'undefined', repr: 'undefined' };
    }
    if (input === null) {
      return { kind: 'primitive', type: 'null', repr: 'null' };
    }
    const typeofValue = typeof input;
    if (typeofValue === 'string') {
      return {
        kind: 'primitive',
        type: 'string',
        repr: clampPrimitiveRepr(
          JSON.stringify(input as string),
          options.truncate
        ),
      };
    }
    if (typeofValue === 'number') {
      return {
        kind: 'primitive',
        type: 'number',
        repr: String(input),
      };
    }
    if (typeofValue === 'boolean') {
      return {
        kind: 'primitive',
        type: 'boolean',
        repr: String(input),
      };
    }
    if (typeofValue === 'bigint') {
      return {
        kind: 'primitive',
        type: 'bigint',
        repr: `${(input as bigint).toString()}n`,
      };
    }
    if (typeofValue === 'symbol') {
      return {
        kind: 'primitive',
        type: 'symbol',
        repr: (input as symbol).toString(),
      };
    }
    if (typeofValue === 'function') {
      const fn = input as { name?: unknown };
      const name = typeof fn.name === 'string' && fn.name.length > 0 ? fn.name : 'anonymous';
      return { kind: 'function', name };
    }
    if (input instanceof Error) {
      return {
        kind: 'error',
        message: clampPrimitiveRepr(
          `${input.name}: ${input.message}`,
          options.truncate
        ),
      };
    }
    if (typeof input === 'object') {
      const objectInput = input as object;
      if (seen.has(objectInput)) {
        return { kind: 'error', message: 'Circular reference' };
      }
      seen.add(objectInput);
      try {
        if (Array.isArray(input)) {
          return walkArray(input, depth);
        }
        return walkObject(objectInput, depth);
      } finally {
        seen.delete(objectInput);
      }
    }
    // Fallback for anything exotic
    return {
      kind: 'primitive',
      type: 'string',
      repr: clampPrimitiveRepr(String(input), options.truncate),
    };
  }

  function walkArray(input: unknown[], depth: number): ScopeValueArray {
    const length = input.length;
    if (depth >= maxDepth) {
      return { kind: 'array', length, entries: [] };
    }
    const cap = Math.min(length, maxArrayEntries);
    const entries: Array<{ index: number; value: ScopeValue }> = [];
    for (let index = 0; index < cap; index += 1) {
      entries.push({ index, value: walk(input[index], depth + 1) });
    }
    const truncatedCount = length > cap ? length - cap : undefined;
    if (truncatedCount !== undefined) {
      return { kind: 'array', length, entries, truncatedCount };
    }
    return { kind: 'array', length, entries };
  }

  function walkObject(input: object, depth: number): ScopeValueObject {
    const previewType =
      (input.constructor && typeof input.constructor.name === 'string'
        ? input.constructor.name
        : 'Object') || 'Object';
    if (depth >= maxDepth) {
      return { kind: 'object', previewType, entries: [] };
    }
    const keys = Object.keys(input);
    const cap = Math.min(keys.length, maxObjectEntries);
    const entries: Array<{ key: string; value: ScopeValue }> = [];
    for (let index = 0; index < cap; index += 1) {
      const key = keys[index]!;
      let nextValue: unknown;
      try {
        nextValue = (input as Record<string, unknown>)[key];
      } catch (err) {
        entries.push({
          key,
          value: {
            kind: 'error',
            message: err instanceof Error ? err.message : 'Access error',
          },
        });
        continue;
      }
      entries.push({ key, value: walk(nextValue, depth + 1) });
    }
    const truncatedCount = keys.length > cap ? keys.length - cap : undefined;
    if (truncatedCount !== undefined) {
      return { kind: 'object', previewType, entries, truncatedCount };
    }
    return { kind: 'object', previewType, entries };
  }
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) return DEFAULT_SCOPE_DEPTH;
  if (depth > MAX_SCOPE_DEPTH) return MAX_SCOPE_DEPTH;
  return Math.floor(depth);
}

// ---------------------------------------------------------------------------
// Snapshot finalization
// ---------------------------------------------------------------------------

/**
 * Build the final `ScopeSnapshot` from the per-variable list. Caps
 * the variable count to `MAX_TOP_LEVEL_VARS` and stamps `capturedAt`.
 * Returns a payload-size guarded snapshot — if the serialized JSON
 * exceeds `MAX_SNAPSHOT_PAYLOAD_BYTES`, the variables array is
 * cleared and `truncatedCount` is set to the original count so the
 * panel can render the "too large to capture" banner.
 */
export function finalizeScopeSnapshot(
  language: string,
  variables: ScopeVariable[]
): ScopeSnapshot {
  const capturedAt = Date.now();
  const total = variables.length;
  const capped = variables.slice(0, MAX_TOP_LEVEL_VARS);
  const droppedAtCap = total > capped.length ? total - capped.length : 0;
  const candidate: ScopeSnapshot = {
    language,
    capturedAt,
    variables: capped,
    ...(droppedAtCap > 0 ? { truncatedCount: droppedAtCap } : {}),
  };
  // Cheap byte estimate via JSON; the worker is single-threaded
  // around the user code so this runs synchronously on the worker
  // side without blocking the main thread.
  let serializedLength: number;
  try {
    serializedLength = JSON.stringify(candidate).length;
  } catch {
    serializedLength = MAX_SNAPSHOT_PAYLOAD_BYTES + 1;
  }
  if (serializedLength > MAX_SNAPSHOT_PAYLOAD_BYTES) {
    return {
      language,
      capturedAt,
      variables: [],
      truncatedCount: total,
    };
  }
  return candidate;
}

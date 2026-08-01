import { truncateSerialized } from '../runners/limits';
import {
  DEFAULT_SCOPE_DEPTH,
  INTERNAL_JS_SYMBOLS,
  type ScopeSnapshot,
  type ScopeVariable,
  finalizeScopeSnapshot,
  serializeScopeValue,
} from '../../shared/scopeSnapshot';
import {
  type RichOutputPayload,
  type RichOutputTable,
  forceTablePayload,
  serializeRichValue,
} from '../../shared/richOutput';

const ctx = self as unknown as Worker;

/**
 * implementation — snapshot of the worker's globals BEFORE any user
 * code runs. The variable inspector subtracts this set from the
 * post-execute `Object.getOwnPropertyNames(self)` so only user-
 * declared bindings survive. Anything injected after module load
 * (the AsyncFunction parameters, `prompt`, `readline`) is still
 * caught by the static `INTERNAL_JS_SYMBOLS` list defined in
 * `src/shared/scopeSnapshot.ts`.
 */
const BOOT_TIME_GLOBALS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(self));

/** Override console methods to capture output and send to main thread */
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  // implementation — `console.table` becomes a first-class method via
  // the proxy shim. The native worker `console.table` is a no-op in
  // most environments; saving the bound original here keeps parity
  // with the other methods even though we never call it after
  // restoration (worker is single-shot today).
  table: typeof console.table === 'function' ? console.table.bind(console) : undefined,
};

/** Fallback only used for malformed legacy messages without a marker. */
export const JS_WORKER_FALLBACK_RESULT_TRUNCATION_MARKER = '[result truncated]';

export function truncateJsWorkerValue(value: string, marker: string): string {
  return truncateSerialized(value, marker);
}

/**
 * implementation — variable-inspector scope capture.
 *
 * Walks `globalThis` keys, filters against the boot-time snapshot
 * + the static internal-symbol list, and serializes each remaining
 * binding via the shared `serializeScopeValue` helper. Returns a
 * payload-bounded `ScopeSnapshot` ready for postMessage.
 *
 * Failure modes are contained — a getter that throws on access is
 * caught inside the per-key loop and emitted as a `kind: 'error'`
 * entry rather than aborting the whole capture.
 */
export function captureJsScope(
  language: string,
  scopeDepth: number | undefined,
  marker: string
): ScopeSnapshot {
  const names = Object.getOwnPropertyNames(self);
  const variables: ScopeVariable[] = [];
  for (const name of names) {
    if (BOOT_TIME_GLOBALS.has(name)) continue;
    if (INTERNAL_JS_SYMBOLS.has(name)) continue;
    let value: unknown;
    try {
      value = (self as unknown as Record<string, unknown>)[name];
    } catch (err) {
      variables.push({
        name,
        value: {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Access error',
        },
      });
      continue;
    }
    try {
      variables.push({
        name,
        value: serializeScopeValue(value, {
          truncate: input => truncateJsWorkerValue(input, marker),
          maxDepth: scopeDepth ?? DEFAULT_SCOPE_DEPTH,
        }),
      });
    } catch (err) {
      variables.push({
        name,
        value: {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Serialization error',
        },
      });
    }
  }
  return finalizeScopeSnapshot(language, variables);
}

export function captureLexicalScope(
  getters: Record<string, () => unknown>,
  scopeDepth: number | undefined,
  marker: string
): ScopeVariable[] {
  const variables: ScopeVariable[] = [];
  for (const [name, getter] of Object.entries(getters)) {
    try {
      variables.push({
        name,
        value: serializeScopeValue(getter(), {
          truncate: input => truncateJsWorkerValue(input, marker),
          maxDepth: scopeDepth ?? DEFAULT_SCOPE_DEPTH,
        }),
      });
    } catch (err) {
      variables.push({
        name,
        value: {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Access error',
        },
      });
    }
  }
  return variables;
}

export function serializeJsWorkerValues(args: unknown[], marker: string): string[] {
  return args.map(arg => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return truncateJsWorkerValue(arg, marker);
    if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return truncateJsWorkerValue(JSON.stringify(arg, null, 2), marker);
    } catch {
      return truncateJsWorkerValue(String(arg), marker);
    }
  });
}

function toJsonStructuredValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return undefined;
  }
  if (typeof value !== 'object') return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => {
        const next = toJsonStructuredValue(item, seen);
        return next === undefined ? null : next;
      });
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = toJsonStructuredValue(item, seen);
      if (next !== undefined) out[key] = next;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * implementation — resilient structured snapshot for the
 * `captureStructuredResult` channel. `structuredClone` is lossless (Map /
 * Set / Date survive) but ALL-OR-NOTHING: a single non-cloneable leaf (a
 * function / symbol / DOM node) throws `DataCloneError` and would drop the
 * whole payload. The notebook rewriter captures top-level functions /
 * classes into `_sessionDelta`, so a cell that declares a helper function
 * beside serializable data hits this routinely. On a clone failure we fall
 * back to a per-leaf JSON-compatible cascade, which silently drops the
 * non-serializable leaves but keeps every serializable sibling — exactly the
 * JSON-sandbox semantics the renderer's `extractSerializableDelta` enforces,
 * minus the 64 KB display truncation. Circular / BigInt-only values that
 * defeat both tiers degrade to `undefined`, and the caller leaves `structured`
 * unset (string-only result; the renderer falls back to an empty delta).
 */
export function safeJsWorkerStructuredResult(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    // The JSON fallback walks user-controlled values, and `Object.entries`
    // invokes getters — a throwing getter or exotic proxy must NOT break an
    // otherwise-clean run (the sibling scope-snapshot capture guards the same
    // way: "capture failures must not break the run"). Degrade to `undefined`
    // so the result stays string-only and the renderer falls back to an empty
    // delta, exactly as for a value that defeats both tiers.
    try {
      return toJsonStructuredValue(value);
    } catch {
      return undefined;
    }
  }
}

/**
 * implementation — produce typed `RichOutputPayload` payloads aligned
 * by index with the legacy `args: string[]` array. The text path stays
 * the canonical fallback; payloads are *additive* on `ConsoleOutput`,
 * never replacing the strings the renderer already paints today.
 */
function serializePayloads(args: unknown[], marker: string): RichOutputPayload[] {
  return args.map(arg =>
    serializeRichValue(arg, {
      truncate: input => truncateJsWorkerValue(input, marker),
    })
  );
}

/**
 * implementation note — `console.table(rows, columns?)` honors a
 * second-arg column-subset list, matching Chrome DevTools behavior.
 * The shim runs over the original `unknown[]`-shaped args, so it has
 * access to the runtime value (not just the stringified preview) and
 * can apply `forceTablePayload` end-to-end.
 *
 * Returns the table payload that should occupy index 0 of the
 * `console.table` payload array. Falls back to a vanilla
 * `forceTablePayload(rows)` when the user passed no column subset, or
 * the requested columns aren't a non-empty subset.
 */
function buildConsoleTablePayload(args: unknown[]): RichOutputTable {
  const [rows, columns] = args;
  const subset =
    Array.isArray(columns) && columns.every(c => typeof c === 'string')
      ? (columns as string[])
      : null;
  const base = forceTablePayload(rows);
  if (!subset || subset.length === 0) return base;
  const indices: number[] = [];
  for (const col of subset) {
    const idx = base.columns.indexOf(col);
    if (idx >= 0) indices.push(idx);
  }
  if (indices.length === 0) return base;
  const filteredColumns = indices.map(i => base.columns[i]!);
  const filteredRows = base.rows.map(row => indices.map(i => row[i]!));
  if (base.truncatedRowCount !== undefined) {
    return {
      kind: 'table',
      columns: filteredColumns,
      rows: filteredRows,
      truncatedRowCount: base.truncatedRowCount,
    };
  }
  return { kind: 'table', columns: filteredColumns, rows: filteredRows };
}

function sourceLineFor(
  generatedLine: number | undefined,
  sourceLineMap: Record<number, number> | undefined
): number | undefined {
  if (generatedLine === undefined) return undefined;
  const mapped = sourceLineMap?.[generatedLine];
  return typeof mapped === 'number' && mapped > 0 ? mapped : generatedLine;
}

function extractCallingLine(sourceLineMap: Record<number, number> | undefined): number | undefined {
  try {
    const stack = new Error().stack ?? '';
    const match = stack.match(/<anonymous>:(\d+):(\d+)/);
    if (match?.[1]) {
      const rawLine = parseInt(match[1], 10);
      // Subtract the 2-line offset from the async function wrapper
      const generatedLine = rawLine > 2 ? rawLine - 2 : rawLine;
      return sourceLineFor(generatedLine, sourceLineMap);
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function installJsWorkerConsoleProxy(
  runId: string,
  marker: string,
  sourceLineMap: Record<number, number> | undefined,
  sourceMappingEnabled: boolean
) {
  const methods = ['log', 'warn', 'error', 'info'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      const line = sourceMappingEnabled ? extractCallingLine(sourceLineMap) : undefined;
      const payload = serializePayloads(args, marker);
      // implementation — stamp the captured source line onto each
      // payload as `origin.line` so the renderer-side
      // `<OutputLineBadge>` can render a chip without re-deriving the
      // line from the top-level `line` field. The main-thread runner
      // passes `sourceMappingEnabled=false` when the user disables the
      // Settings master toggle, so the worker skips stack capture and
      // does not leak origin metadata into history capsules.
      if (typeof line === 'number' && line > 0 && payload) {
        for (const p of payload) {
          if (p && typeof p === 'object' && !p.origin) {
            (p as { origin?: { line: number } }).origin = { line };
          }
        }
      }
      ctx.postMessage({
        type: 'console',
        runId,
        method,
        args: serializeJsWorkerValues(args, marker),
        payload,
        line,
      });
    };
  }

  // implementation — `console.table(rows, columns?)` shim. Routes to
  // a `log` console entry (matches Chrome DevTools behavior) but
  // overrides the payload[0] with a forced `RichOutputTable`, honoring
  // the optional column-subset second argument.
  //
  // Two edge cases worth noting:
  //   - The `columns` argument is consumed by `buildConsoleTablePayload`
  //     and intentionally NOT emitted as a separate payload (it would
  //     surface to the renderer as a meaningless `ScopeValueArray` of
  //     the column names and break the args ↔ payload 1:1 invariant).
  //   - `console.table()` with no arguments emits a single empty-table
  //     entry rather than `Table(1×1)` over an undefined cell.
  (console as { table?: (...a: unknown[]) => void }).table = (...args: unknown[]) => {
    const line = sourceMappingEnabled ? extractCallingLine(sourceLineMap) : undefined;
    // implementation — mirror the per-method `origin.line`
    // stamp from `createConsoleProxy` (lines 282-292) so the
    // `console.table` shim's table payload also carries an origin.
    // Without this, `console.table([...])` rows never render the
    // `<OutputLineBadge>` chip even when the source line is known.
    // Stamp respects the same `sourceMappingEnabled` gate.
    const stampTableOrigin = (payload: RichOutputPayload) => {
      if (
        sourceMappingEnabled &&
        typeof line === 'number' &&
        line > 0 &&
        payload &&
        typeof payload === 'object' &&
        !payload.origin
      ) {
        (payload as { origin?: { line: number } }).origin = { line };
      }
    };
    if (args.length === 0) {
      const emptyTable: RichOutputPayload = {
        kind: 'table',
        columns: [],
        rows: [],
      } as RichOutputPayload;
      stampTableOrigin(emptyTable);
      ctx.postMessage({
        type: 'console',
        runId,
        method: 'log',
        args: ['Table(0×0)'],
        payload: [emptyTable],
        line,
        consoleTableInvoked: true,
      });
      return;
    }
    const tablePayload = buildConsoleTablePayload(args);
    const rowCount = tablePayload.rows.length + (tablePayload.truncatedRowCount ?? 0);
    // The optional `columns` subset argument is consumed by
    // `buildConsoleTablePayload`; do not echo it into the fallback
    // text, or the legacy path renders `Table(...) ["col"]`.
    const textArgs = [`Table(${rowCount}×${tablePayload.columns.length})`];
    stampTableOrigin(tablePayload);
    // Only the table payload occupies the payload array.
    const payloads: RichOutputPayload[] = [tablePayload];
    ctx.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: textArgs,
      payload: payloads,
      line,
      // implementation note adoption signal — surfaced as a separate
      // `runtime.console_table_called` telemetry event by the runner
      // when it sees this flag (the worker is renderer-blind).
      consoleTableInvoked: true,
    });
  };
}

export function restoreJsWorkerConsole() {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  if (originalConsole.table) {
    console.table = originalConsole.table;
  } else {
    delete (console as { table?: unknown }).table;
  }
}

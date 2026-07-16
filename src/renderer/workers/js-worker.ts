/**
 * JavaScript execution Web Worker.
 *
 * Runs user code in an isolated context with console capture.
 * Communication via structured messages (WorkerInboundMessage in /
 * WorkerResponse out — see IT2-A4 note above WorkerInboundMessage).
 *
 * RL-078: this worker no longer schedules its own deadline. The
 * parent renderer thread owns a kill timer and calls
 * `worker.terminate()` if user code does not yield in time. The
 * `runId` from each `execute` request is echoed on every reply so
 * the parent can drop messages from a previous (terminated) run.
 *
 * RL-027 Slice 1: when the renderer instrumented the source, the
 * `execute` payload carries `{ debug: true, breakpoints, ... }`. The
 * worker injects two closure helpers — `__lingua_dbg_yield(line, getLocals)`
 * called before each statement, and `__lingua_dbg_frame(name, line)` /
 * `__lingua_dbg_pop()` for frame-depth tracking that powers step-over
 * / step-into / step-out. Pauses fire only when the breakpoint set
 * contains the current line OR the current step mode dictates a stop;
 * otherwise the yield function fast-paths to `Promise.resolve()`.
 *
 * Reference: RL-027 Slice 1 and `docs/DEBUGGER_ADR.md`.
 *
 * RL-144 (AUDIT-24): trust boundary for the `new AsyncFunction(...)`
 * eval below. The renderer/main thread is already trusted and hands
 * us the user's own source verbatim — no remote or adversarial input
 * reaches this surface, so this is NOT a sandbox for hostile code.
 * The Web Worker isolation exists to bound the blast radius of
 * runtime faults (unhandled exceptions, infinite loops, runaway
 * memory) so the renderer can `worker.terminate()` and recover,
 * not to defend against an attacker who controls `code`. Note that
 * the Node-only symbols `process` and `require` are absent here by
 * the Web Worker global contract: this file runs in a DOM-less
 * worker scope, so reading `globalThis.process` / `globalThis.require`
 * returns `undefined` and the worker cannot escalate into Node.
 * `tests/workers/js-worker-helpers.test.ts` locks that invariant.
 * If a future bundler/runtime change ever leaks either symbol into
 * the worker scope, that is a security-boundary regression — treat
 * it as such and do not paper over it.
 */

// Make this file a module so TS doesn't merge its scope with other workers
export {};

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
  validateChartSpec,
  validateHtmlPayload,
  validateImageSrc,
} from '../../shared/richOutput';
import { parseJsErrorStack } from '../../shared/errorStack';
import type { DebuggerControlMessage } from '../runtime/debuggerWorkerBridge';

// Type-safe message posting (Worker context has no DOM types)
const ctx = self as unknown as Worker;

/**
 * RL-020 Slice 9 — snapshot of the worker's globals BEFORE any user
 * code runs. The variable inspector subtracts this set from the
 * post-execute `Object.getOwnPropertyNames(self)` so only user-
 * declared bindings survive. Anything injected after module load
 * (the AsyncFunction parameters, `prompt`, `readline`) is still
 * caught by the static `INTERNAL_JS_SYMBOLS` list defined in
 * `src/shared/scopeSnapshot.ts`.
 */
const BOOT_TIME_GLOBALS: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(self)
);

/** Override console methods to capture output and send to main thread */
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  // RL-044 Slice 1B — `console.table` becomes a first-class method via
  // the proxy shim. The native worker `console.table` is a no-op in
  // most environments; saving the bound original here keeps parity
  // with the other methods even though we never call it after
  // restoration (worker is single-shot today).
  table: typeof console.table === 'function' ? console.table.bind(console) : undefined,
};

/** Fallback only used for malformed legacy messages without a marker. */
const FALLBACK_RESULT_TRUNCATION_MARKER = '[result truncated]';

function truncate(value: string, marker: string): string {
  return truncateSerialized(value, marker);
}

/**
 * RL-020 Slice 9 — variable-inspector scope capture.
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
function captureJsScope(
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
          truncate: (input) => truncate(input, marker),
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

function captureLexicalScope(
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
          truncate: (input) => truncate(input, marker),
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

function serialize(args: unknown[], marker: string): string[] {
  return args.map((arg) => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return truncate(arg, marker);
    if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return truncate(JSON.stringify(arg, null, 2), marker);
    } catch {
      return truncate(String(arg), marker);
    }
  });
}

function toJsonStructuredValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
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
      return value.map((item) => {
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
 * RL-043 Slice B — resilient structured snapshot for the
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
function safeStructuredResult(value: unknown): unknown {
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
 * RL-044 Slice 1B — produce typed `RichOutputPayload` payloads aligned
 * by index with the legacy `args: string[]` array. The text path stays
 * the canonical fallback; payloads are *additive* on `ConsoleOutput`,
 * never replacing the strings the renderer already paints today.
 */
function serializePayloads(args: unknown[], marker: string): RichOutputPayload[] {
  return args.map((arg) =>
    serializeRichValue(arg, {
      truncate: (input) => truncate(input, marker),
    })
  );
}

/**
 * RL-044 Slice 1B fold D — `console.table(rows, columns?)` honors a
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
    Array.isArray(columns) && columns.every((c) => typeof c === 'string')
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
  const filteredColumns = indices.map((i) => base.columns[i]!);
  const filteredRows = base.rows.map((row) => indices.map((i) => row[i]!));
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

function extractCallingLine(
  sourceLineMap: Record<number, number> | undefined
): number | undefined {
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

function createConsoleProxy(
  runId: string,
  marker: string,
  sourceLineMap: Record<number, number> | undefined,
  sourceMappingEnabled: boolean
) {
  const methods = ['log', 'warn', 'error', 'info'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      const line = sourceMappingEnabled
        ? extractCallingLine(sourceLineMap)
        : undefined;
      const payload = serializePayloads(args, marker);
      // RL-044 Sub-slice G — stamp the captured source line onto each
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
        args: serialize(args, marker),
        payload,
        line,
      });
    };
  }

  // RL-044 Slice 1B — `console.table(rows, columns?)` shim. Routes to
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
  (console as { table?: (...a: unknown[]) => void }).table = (
    ...args: unknown[]
  ) => {
    const line = sourceMappingEnabled
      ? extractCallingLine(sourceLineMap)
      : undefined;
    // RL-044 Sub-slice G.1 — mirror the per-method `origin.line`
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
    const rowCount =
      tablePayload.rows.length + (tablePayload.truncatedRowCount ?? 0);
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
      // Fold F adoption signal — surfaced as a separate
      // `runtime.console_table_called` telemetry event by the runner
      // when it sees this flag (the worker is renderer-blind).
      consoleTableInvoked: true,
    });
  };
}

function restoreConsole() {
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

/**
 * RL-044 Slice 2b-α — `lingua` worker bridge factory. Returns the
 * `{ chart, image, html }` helpers user code calls inside the
 * AsyncFunction sandbox. Each helper:
 *
 *   1. Runs the matching `validate*` whitelist from `shared/richOutput`.
 *   2. On reject → posts a `console` message with a text fallback +
 *      a `richMediaRejected` flag. Runner-side telemetry forwarding
 *      landed in Slice 2b-β-β-α — JS / TS / Python runners all
 *      forward the flag to `runtime.rich_media_payload_rejected`.
 *   3. On accept → posts a `console` log with `args: [<rawText>]`
 *      and `payload: [<typed payload>]` so the renderer dispatches to
 *      the dedicated renderer component when one exists.
 *
 * The bridge is closure-scoped per execute() call so there's no
 * cross-run leak; cleanup is implicit when the AsyncFunction returns.
 */
function buildLinguaWorkerBridge(
  context: Worker,
  runId: string
): { chart: (spec: unknown) => void; image: (payload: unknown) => void; html: (html: unknown) => void } {
  const postRejection = (
    kind: 'chart' | 'image' | 'html',
    reason: 'invalid-src' | 'size-limit' | 'validation-failed',
    fallbackText: string
  ): void => {
    context.postMessage({
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
    context.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: [fallbackText],
      payload: [payload],
    });
  };

  // RL-044 Slice 2b-β-α Prerequisite fix — informative rejection text.
  // The bridge previously emitted a generic `[chart spec rejected]` /
  // `[image rejected: invalid source]` / `[html payload rejected]`
  // with no actionable context. Users couldn't tell whether they hit
  // the spec-security whitelist (data.url/data.name), the size cap,
  // a missing required field, or just a typo. The reasons below map
  // 1:1 to the closed-enum `RICH_MEDIA_REJECTED_REASONS` shipped on
  // Slice 2a, so dashboards and humans see the same diagnosis.
  const rejectChart = (): void => {
    const reasonText = '[chart rejected: remote/named data not allowed (use data.values inline)]';
    postRejection('chart', 'validation-failed', reasonText);
  };
  const rejectImage = (
    reason: 'invalid-src' | 'validation-failed',
    detail?: string
  ): void => {
    const reasonText =
      reason === 'invalid-src'
        ? '[image rejected: src must be data:image/, blob:, or https://]'
        : `[image rejected: ${detail ?? 'invalid payload (expected { src, mime })'}]`;
    postRejection('image', reason, reasonText);
  };
  const rejectHtml = (reason: 'size-limit' | 'validation-failed'): void => {
    const reasonText =
      reason === 'size-limit'
        ? '[html rejected: payload exceeds 256 KB cap]'
        : '[html rejected: expected a non-empty string]';
    postRejection('html', reason, reasonText);
  };

  return {
    chart: (spec) => {
      const validated = validateChartSpec(spec);
      if (validated === null) {
        rejectChart();
        return;
      }
      postPayload({ kind: 'chart', spec: validated }, '[chart]');
    },
    image: (raw) => {
      if (!raw || typeof raw !== 'object') {
        rejectImage('validation-failed', 'expected { src, mime }');
        return;
      }
      const { src, mime } = raw as { src?: unknown; mime?: unknown };
      const validatedSrc = validateImageSrc(src);
      if (validatedSrc === null) {
        rejectImage('invalid-src');
        return;
      }
      const mimeString = typeof mime === 'string' && mime.length > 0 ? mime : 'image/png';
      postPayload(
        { kind: 'image', src: validatedSrc, mime: mimeString },
        `[image ${mimeString}]`
      );
    },
    html: (raw) => {
      const validated = validateHtmlPayload(raw);
      if (validated === null) {
        const reason: 'size-limit' | 'validation-failed' =
          typeof raw === 'string' && raw.length > 0 ? 'size-limit' : 'validation-failed';
        rejectHtml(reason);
        return;
      }
      postPayload({ kind: 'html', html: validated }, '[html sandboxed]');
    },
  };
}

/**
 * Parse error to extract line/column from stack trace + structured
 * stack frames for the renderer's clickable-stack surface (RL-044
 * Sub-slice F).
 */
function parseError(err: unknown): {
  message: string;
  line?: number;
  column?: number;
  stack?: string;
  frames?: import('../../shared/errorStack').ClickableStackFrame[];
} {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }

  const result: {
    message: string;
    line?: number;
    column?: number;
    stack?: string;
    frames?: import('../../shared/errorStack').ClickableStackFrame[];
  } = {
    message: err.message,
    stack: err.stack,
  };

  // Try to extract line/column from stack trace
  // Format: "at eval (eval at <anonymous> (:1:1), <anonymous>:LINE:COL)"
  // or:     "at <anonymous>:LINE:COL"
  if (err.stack) {
    const match = err.stack.match(/<anonymous>:(\d+):(\d+)/);
    const lineValue = match?.[1];
    const columnValue = match?.[2];
    if (lineValue && columnValue) {
      result.line = parseInt(lineValue, 10);
      result.column = parseInt(columnValue, 10);
    }
    // RL-044 Slice 2b-α — structured stack for the renderer's
    // `<RichValueError>` surface. Best-effort: unparseable frames stay
    // as text-only in the parsed array.
    const frames = parseJsErrorStack(err.stack);
    if (frames.length > 0) {
      result.frames = frames;
    }
  }

  return result;
}

/**
 * RL-027 Slice 1 — debugger pause coordination.
 *
 * Slice 1 ships the pause/resume/step protocol with frame-depth
 * tracking. Conditional breakpoint predicates and watch expressions
 * are STORED on the session (so the UI surfaces them) but their
 * evaluation lands in Slice 1.5 — the eval mechanism needs a
 * dedicated security review pass that this slice doesn't budget.
 * For Slice 1, conditional breakpoints always pause (as if the
 * predicate were `true`), and watch results carry an
 * `evaluation: 'pending'` marker so the UI can render the deferred
 * state without misleading the user.
 */
type StepMode = 'none' | 'over' | 'into' | 'out';

interface DebuggerSessionState {
  runId: string;
  enabled: boolean;
  breakpoints: Map<number, { condition: string }>;
  watches: string[];
  stepMode: StepMode;
  /** Frame depth at which the active step request was issued. */
  stepDepth: number;
  /** Live call stack — newest frame last. */
  frames: { functionName: string; line: number }[];
  /** Resolver for the pending `resume`/`step` await. */
  resumeResolver: (() => void) | null;
}

function createSession(runId: string): DebuggerSessionState {
  return {
    runId,
    enabled: false,
    breakpoints: new Map(),
    watches: [],
    stepMode: 'none',
    stepDepth: 0,
    frames: [],
    resumeResolver: null,
  };
}

interface ExecuteMessage {
  type: 'execute';
  runId: string;
  code: string;
  resultTruncationMarker?: string;
  debug?: boolean;
  breakpoints?: { line: number; condition?: string }[];
  watches?: string[];
  sourceLineMap?: Record<number, number>;
  /**
   * RL-044 Sub-slice G — false disables console-origin stack capture
   * so the worker does not attach `line` / `payload.origin` metadata
   * when the Settings master toggle is off.
   */
  sourceMappingEnabled?: boolean;
  /**
   * RL-020 Slice 6 — pre-set stdin buffer for `prompt()` /
   * `readline()`. Newline-delimited. Empty / undefined leaves the
   * native worker behavior in place (worker has no `prompt`, so
   * calls throw `ReferenceError`).
   */
  stdin?: string;
  /**
   * RL-020 Slice 9 — when `true`, capture the post-execute global
   * scope and emit a `'scope-snapshot'` reply before `done`. The
   * runner sets this when the user has the variable inspector
   * toggle on for the active tab (or wants the data eagerly
   * available so the toggle lights up); skipping the capture keeps
   * the hot path cheap when the inspector is off.
   */
  captureScope?: boolean;
  /**
   * RL-020 Slice 9 fold E — recursion depth for the scope walker.
   * Defaults to `DEFAULT_SCOPE_DEPTH` (1). `MAX_SCOPE_DEPTH` (4)
   * is the runner-side cap.
   */
  scopeDepth?: number;
  /**
   * RL-020 Slice 9 — language id stamped on the snapshot. Lets the
   * shared JS worker emit `'typescript'` when invoked by the TS
   * runner.
   */
  scopeLanguage?: string;
  /**
   * RL-043 Slice B — when `true`, ALSO post the structured return
   * value on the `'result'` reply (`structured` field) so the notebook
   * runner round-trips `{ stdout, stderr, sessionDelta }` losslessly
   * instead of parsing the truncated display string. Snapshotted via
   * `safeStructuredResult` (structuredClone → JSON round-trip cascade),
   * so non-serializable leaves drop while serializable siblings survive.
   */
  captureStructuredResult?: boolean;
}

/**
 * IT2-A4 — every message the JS/TS worker can receive. `execute` starts
 * a run; the debugger-control variants (`resume` / `step` /
 * `set-breakpoints`) reuse the SAME union the sender posts
 * (`DebuggerControlMessage` from `debuggerWorkerBridge`). Asserted once
 * at the message boundary so the handler narrows by `type` with no
 * per-branch casts, and an exhaustiveness `never` check flags any new
 * inbound variant that lacks a handler.
 */
type WorkerInboundMessage = ExecuteMessage | DebuggerControlMessage;

/**
 * RL-020 Slice 6 — line-by-line stdin reader. The worker constructs
 * a fresh reader on each `execute` request; consumed lines are
 * tracked locally and reported back to the main thread via the
 * `stdin-consumed` reply right before `done`. `getCount()` and
 * `getTotal()` feed the fold-G "Used N of M lines" surface.
 */
interface StdinReader {
  consume: () => string | null;
  getCount: () => number;
  getTotal: () => number;
}

function createStdinReader(buffer: string | undefined): StdinReader {
  if (!buffer || buffer.length === 0) {
    return {
      consume: () => null,
      getCount: () => 0,
      getTotal: () => 0,
    };
  }
  // Split on `\n`; trim a trailing empty segment so the user typing
  // `2\n3\n` is the same as `2\n3` (3 reads would return null on the
  // 3rd call either way).
  const rawLines = buffer.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  let cursor = 0;
  return {
    consume: () => {
      if (cursor >= rawLines.length) return null;
      const value = rawLines[cursor]!;
      cursor += 1;
      return value;
    },
    getCount: () => cursor,
    getTotal: () => rawLines.length,
  };
}

function applyExecutePayload(session: DebuggerSessionState, msg: ExecuteMessage): void {
  session.enabled = msg.debug === true;
  session.breakpoints.clear();
  if (Array.isArray(msg.breakpoints)) {
    for (const bp of msg.breakpoints) {
      if (typeof bp.line === 'number' && bp.line > 0) {
        session.breakpoints.set(bp.line, { condition: bp.condition ?? '' });
      }
    }
  }
  session.watches = Array.isArray(msg.watches) ? msg.watches : [];
  session.stepMode = 'none';
  session.stepDepth = 0;
  session.frames = [];
  session.resumeResolver = null;
}

let activeSession: DebuggerSessionState | null = null;

ctx.addEventListener('message', async (event) => {
  // IT2-A4 — one deliberate boundary assertion; `MessageEvent.data` is
  // untyped by the DOM. Every branch below narrows by `msg.type` with no
  // further casts, and the exhaustiveness guard after the last branch
  // makes an unhandled variant a compile error.
  const msg = event.data as WorkerInboundMessage;

  // RL-027 Slice 1 — debugger control messages from main. These
  // arrive WHILE a run is ongoing (the worker is paused awaiting a
  // resume), so we route them ahead of the `execute` branch.
  if (msg.type === 'resume' || msg.type === 'step') {
    const session = activeSession;
    if (!session || !session.resumeResolver) return;
    if (msg.type === 'step') {
      session.stepMode = msg.mode ?? 'over';
      session.stepDepth = session.frames.length;
    } else {
      session.stepMode = 'none';
    }
    ctx.postMessage({ type: 'resumed', runId: session.runId });
    const resolver = session.resumeResolver;
    session.resumeResolver = null;
    resolver();
    return;
  }

  if (msg.type === 'set-breakpoints') {
    const session = activeSession;
    if (!session) return;
    session.breakpoints.clear();
    const bps = msg.breakpoints;
    if (Array.isArray(bps)) {
      for (const bp of bps) {
        if (typeof bp.line === 'number' && bp.line > 0) {
          session.breakpoints.set(bp.line, { condition: bp.condition ?? '' });
        }
      }
    }
    return;
  }

  if (msg.type === 'execute') {
    const exec = msg;
    const { runId, code, resultTruncationMarker } = exec;
    const marker =
      typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
        ? resultTruncationMarker
        : FALLBACK_RESULT_TRUNCATION_MARKER;
    const startTime = performance.now();

    createConsoleProxy(
      runId,
      marker,
      exec.sourceLineMap,
      exec.sourceMappingEnabled !== false
    );

    const session = createSession(runId);
    applyExecutePayload(session, exec);
    activeSession = session;
    let lexicalScopeVariables: ScopeVariable[] | null = null;

    // RL-020 Slice 6 — install line-by-line stdin readers. We
    // capture the previous values so a follow-up run starts from a
    // clean global scope (workers are single-shot today so this is
    // belt-and-braces, but if a future runner reuses the same
    // worker context the restoration keeps it honest).
    const stdinReader = createStdinReader(exec.stdin);
    const prevPrompt = (self as unknown as { prompt?: unknown }).prompt;
    const prevReadline = (self as unknown as { readline?: unknown }).readline;
    if (exec.stdin && exec.stdin.length > 0) {
      const consumer = () => stdinReader.consume();
      (self as unknown as { prompt: (message?: string) => string | null }).prompt =
        consumer;
      (self as unknown as { readline: () => string | null }).readline = consumer;
    }

    // RL-115 Slice 1 — per-statement wall-clock ticks. The runner's
    // transform prefixes each top-level statement with
    // `__mc_tick(<line>)`; each tick closes the PREVIOUS statement's
    // interval and opens its own, so the elapsed time between two
    // ticks is attributed to the earlier statement. `flushLineTimings`
    // closes the final open interval and posts ONE batched message —
    // called on success AND on the error path so the statements that
    // did complete keep their measurements.
    const lineTimings: Array<{ line: number; durationMs: number }> = [];
    let tickLine: number | null = null;
    let tickStart = 0;
    const __mc_tick = (line: number) => {
      const now = performance.now();
      if (tickLine !== null) {
        lineTimings.push({ line: tickLine, durationMs: now - tickStart });
      }
      tickLine = line > 0 ? line : null;
      tickStart = now;
    };
    const flushLineTimings = () => {
      __mc_tick(0);
      if (lineTimings.length > 0) {
        ctx.postMessage({ type: 'line-timing', runId, entries: lineTimings });
        lineTimings.length = 0;
      }
    };

    try {
      const executionPromise = (async () => {
        const __mc = (line: number, value: unknown) => {
          let serialized: string;
          try {
            serialized = serialize([value], marker)[0]!;
          } catch {
            serialized = truncate(String(value), marker);
          }
          ctx.postMessage({
            type: 'magic-comment',
            runId,
            line,
            value: serialized,
          });
        };

        // RL-027 Slice 1 — yield helper. Called before each
        // instrumented statement. Fast path when debug is off OR
        // no breakpoint matches AND no step mode is armed.
        const __lingua_dbg_yield = async (
          line: number,
          getLocals: () => Record<string, unknown>
        ): Promise<void> => {
          if (!session.enabled) return;
          const breakpoint = session.breakpoints.get(line);
          const shouldPauseForStep =
            session.stepMode === 'into' ||
            (session.stepMode === 'over' &&
              session.frames.length <= session.stepDepth) ||
            (session.stepMode === 'out' && session.frames.length < session.stepDepth);

          // Slice 1: predicates are stored but always treated as true
          // (no eval until Slice 1.5's security review). The UI badge
          // surfaces this as "predicate stored, evaluation pending".
          const shouldPauseForBreakpoint = Boolean(breakpoint);

          if (!shouldPauseForBreakpoint && !shouldPauseForStep) return;

          const localsRaw = (() => {
            try {
              return getLocals();
            } catch {
              return {};
            }
          })();
          const localsSerialized: Record<string, string> = {};
          for (const [name, value] of Object.entries(localsRaw)) {
            localsSerialized[name] = serialize([value], marker)[0]!;
          }

          // Slice 1: watch expressions echo back as `pending` markers.
          // The Variables panel covers the actual locals; users who
          // want richer expressions will get them in Slice 1.5.
          const watchResults: Record<
            string,
            { value?: string; error?: string; pending?: boolean }
          > = {};
          for (const expr of session.watches) {
            watchResults[expr] = { pending: true };
          }

          const reason: 'user-breakpoint' | 'step' = shouldPauseForBreakpoint
            ? 'user-breakpoint'
            : 'step';

          ctx.postMessage({
            type: 'paused',
            runId,
            line,
            reason,
            locals: localsSerialized,
            callStack: [...session.frames].reverse(),
            watchResults,
            conditionalPending: Boolean(breakpoint?.condition),
          });

          await new Promise<void>((resolve) => {
            session.resumeResolver = resolve;
          });
        };

        const __lingua_dbg_frame = (
          functionName: string,
          line: number
        ): void => {
          session.frames.push({ functionName, line });
        };

        const __lingua_dbg_pop = (): void => {
          session.frames.pop();
        };

        const __lingua_capture_scope = (
          getters: Record<string, () => unknown>
        ): void => {
          lexicalScopeVariables = captureLexicalScope(
            getters,
            exec.scopeDepth,
            marker
          );
        };

        // RL-044 Slice 2b-α — rich-media helpers exposed to user code as
        // the `lingua` parameter. Closure-bound (not on globalThis) so
        // there's no global pollution and the binding goes out of scope
        // when the AsyncFunction returns. Each helper validates the
        // payload via the shared whitelist. Rejects include a
        // `richMediaRejected` flag; the JS / TS / Python runners
        // forward that flag to `runtime.rich_media_payload_rejected`
        // (RL-044 Slice 2b-β-β-α fold A).
        const lingua = buildLinguaWorkerBridge(ctx, runId);

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const fn = new AsyncFunction(
          '__mc',
          '__mc_tick',
          '__lingua_dbg_yield',
          '__lingua_dbg_frame',
          '__lingua_dbg_pop',
          '__lingua_capture_scope',
          'lingua',
          code
        );
        return await fn(
          __mc,
          __mc_tick,
          __lingua_dbg_yield,
          __lingua_dbg_frame,
          __lingua_dbg_pop,
          __lingua_capture_scope,
          lingua
        );
      })();

      const result = await executionPromise;
      // Close the last statement's interval BEFORE scope capture /
      // result serialization so their cost never pollutes it.
      flushLineTimings();

      if (result !== undefined) {
        const resultMessage: {
          type: 'result';
          runId: string;
          value: unknown;
          structured?: unknown;
        } = {
          type: 'result',
          runId,
          value: serialize([result], marker)[0],
        };
        // RL-043 Slice B — forward the live structured value (the
        // notebook's `{ stdout, stderr, sessionDelta }`) when asked, so
        // the runner can round-trip it losslessly instead of parsing the
        // display string that `serialize` truncates at MAX_RESULT_BYTES.
        // `safeStructuredResult` is resilient: a bare `structuredClone`
        // would drop the WHOLE delta when a cell declares a function /
        // class beside serializable data (the rewriter captures those into
        // `_sessionDelta`), so it cascades per leaf and keeps the
        // serializable siblings. `undefined` ⇒ leave it string-only.
        if (exec.captureStructuredResult === true) {
          const snapshot = safeStructuredResult(result);
          if (snapshot !== undefined) resultMessage.structured = snapshot;
        }
        ctx.postMessage(resultMessage);
      }

      // RL-020 Slice 9 — capture the post-execute scope BEFORE the
      // stdin-consumed / done replies so the runner can stitch the
      // snapshot onto the `ExecutionResult` it builds at `done`.
      // The capture is gated on `exec.captureScope` to keep the hot
      // path cheap when the inspector toggle is off; the runner
      // decides whether to ask. Reads `globalThis` keys, subtracts
      // the boot-time set + the known internal helpers, and walks
      // each remaining binding via the shared serializer.
      if (exec.captureScope === true) {
        try {
          const snapshot =
            lexicalScopeVariables !== null
              ? finalizeScopeSnapshot(
                  exec.scopeLanguage ?? 'javascript',
                  lexicalScopeVariables
                )
              : captureJsScope(
                  exec.scopeLanguage ?? 'javascript',
                  exec.scopeDepth,
                  marker
                );
          ctx.postMessage({ type: 'scope-snapshot', runId, snapshot });
        } catch (captureErr) {
          // Capture failures must not break the run. Emit an empty
          // snapshot so the runner still threads the field through
          // to the result store and the panel can render the empty
          // state instead of stale data.
          ctx.postMessage({
            type: 'scope-snapshot',
            runId,
            snapshot: finalizeScopeSnapshot(
              exec.scopeLanguage ?? 'javascript',
              []
            ),
            error:
              captureErr instanceof Error
                ? captureErr.message
                : String(captureErr),
          });
        }
      }

      const executionTime = performance.now() - startTime;
      // RL-020 Slice 6 fold G — emit consumption summary BEFORE the
      // `done` reply so the runner can stitch it onto the
      // `ExecutionResult` the panel renders.
      if (stdinReader.getTotal() > 0) {
        ctx.postMessage({
          type: 'stdin-consumed',
          runId,
          count: stdinReader.getCount(),
          total: stdinReader.getTotal(),
        });
      }
      ctx.postMessage({ type: 'done', runId, executionTime });
    } catch (err) {
      const executionTime = performance.now() - startTime;
      // Flush what we have: completed statements keep their exact
      // measurements and the failing statement reports the time it ran
      // before throwing — often the most interesting number of the run.
      flushLineTimings();
      const parsed = parseError(err);

      ctx.postMessage({
        type: 'error',
        runId,
        error: parsed,
      });

      if (stdinReader.getTotal() > 0) {
        ctx.postMessage({
          type: 'stdin-consumed',
          runId,
          count: stdinReader.getCount(),
          total: stdinReader.getTotal(),
        });
      }
      ctx.postMessage({ type: 'done', runId, executionTime });
    } finally {
      restoreConsole();
      // Restore the previous prompt / readline bindings even though
      // the worker is single-shot — keeps the worker test harness
      // honest if a future test reuses the context. When the
      // previous binding was `undefined` (the worker has no native
      // `prompt`), DELETE the own property rather than re-assigning
      // it to literal `undefined`; otherwise `'prompt' in self`
      // would return `true` after restoration and a future
      // "was patched?" check would misread the state.
      const selfWithIO = self as unknown as {
        prompt?: unknown;
        readline?: unknown;
      };
      if (prevPrompt === undefined) {
        delete selfWithIO.prompt;
      } else {
        selfWithIO.prompt = prevPrompt;
      }
      if (prevReadline === undefined) {
        delete selfWithIO.readline;
      } else {
        selfWithIO.readline = prevReadline;
      }
      activeSession = null;
    }
    return;
  }

  // IT2-A4 — exhaustiveness lock: adding a new WorkerInboundMessage
  // variant without a branch above turns this assignment into a compile
  // error (the narrowed remainder must be `never`).
  const unhandled: never = msg;
  void unhandled;
});

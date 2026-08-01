/**
 * Renderer execution and runner contracts.
 *
 * Runtime adapters, orchestration, diagnostics, and result state import this
 * leaf directly. The historical types index re-exports these names only for
 * compatibility and must not become a production dependency again.
 */

import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
import type { ScopeSnapshot } from '../../shared/scopeSnapshot';
import type { RichOutputPayload } from '../../shared/richOutput';
import type { Language } from './language';

export interface ExecutionContext {
  /**
   * Source language for runtime-mode runners that are not keyed by
   * the original language in their own `LanguageRunner` metadata
   * (for example JS / TS tabs routed through desktop Node).
   */
  language?: string;
  /**
   * Absolute source path for desktop-native runners that need a
   * project-aware cwd. Undefined for unsaved Scratchpad tabs.
   */
  filePath?: string;
  timeout?: number;
  env?: Record<string, string>;
  /**
   * Optional streaming hook for manual execution surfaces. Runners still
   * return the full stdout/stderr arrays at completion; this hook lets
   * the result panel show progress while a debug session is paused.
   */
  onConsole?: (output: ConsoleOutput) => void;
  /**
   * Explicit debugger intent from the UI. Normal Run must ignore
   * breakpoints; only Debug should attach the worker pause protocol.
   */
  debug?: boolean;
  /**
   * implementation — tab id of the source being executed. The
   * debugger runner reads breakpoints + watches from the debugger
   * store keyed by this id, so a run on a different tab does not
   * trigger pauses set on another tab.
   */
  tabId?: string;
  /**
   * implementation — JS / TS auto-log mode. When `true` the JS / TS
   * runner runs a second source transform that replaces every
   * top-level bare expression statement with an `__mc(line, value)`
   * capture (after the magic-comment transform) so values surface
   * inline without the user typing a `//=>` and side effects run
   * once. Only the
   * auto-run path passes this flag; manual Run + Debug never
   * auto-log.
   */
  autoLog?: boolean;
  /**
   * implementation — per-line timing via the Settings toggle. When
   * `true` the JS / TS runner prefixes every top-level statement with
   * a `__mc_tick(line)` marker so the worker can attribute wall-clock
   * time per statement. A `// @time` magic comment in the buffer
   * enables the same instrumentation regardless of this flag; debug
   * runs never instrument.
   */
  lineTiming?: boolean;
  /**
   * implementation — pre-set stdin buffer the worker consumes for
   * `prompt()` / `readline()` (JS / TS) or `input()` (Python).
   * Newline-delimited; each call consumes one line. Empty /
   * undefined ⇒ native worker behavior. Layered onto the existing
   * `runner.execute` contract; runners that do not consume stdin
   * ignore the field harmlessly.
   */
  stdin?: string;
  /** internal — argv from the active input set; unsupported runners ignore it. */
  args?: string[];
  /**
   * implementation — the resolved preset that produced the active
   * `timeout`. Used by `runnerTimeoutResult` to populate the
   * `RunStatusPill` tooltip with the human-readable preset name
   * ("Run hit the quick limit (5s)"). When `'override'` the run is
   * using an explicit caller-supplied timeout (one-shot extended,
   * magic-comment `// @timeout`, etc.) instead of a Settings
   * preset, and the tooltip falls back to the duration without
   * naming a preset.
   */
  timeoutPreset?: RuntimeTimeoutPreset | 'override';
  /**
   * implementation — BrowserPreviewRunner keeps the last successful srcdoc
   * visible when a silent live refresh errors, times out, or is superseded.
   * Manual runs omit this flag and keep their explicit stop semantics.
   */
  preserveBrowserPreviewOnFailure?: boolean;
  /**
   * implementation — when `true`, the runner asks its worker to
   * capture the post-execute scope and emit a `ScopeSnapshot` on
   * the resulting `ExecutionResult`. Runners that do not implement
   * scope capture ignore the field harmlessly. The runtime layers
   * (auto-run + manual run) set this to `true` whenever the active
   * tab's `variableInspectorEnabled` flag is on OR the language is
   * one of the inspector's supported set, so the toggle can light
   * up after the first clean run even without the user opting in
   * first.
   */
  captureScope?: boolean;
  /**
   * implementation note — recursion depth for the scope walker
   * (1–4). `1` is the base scope and matches the renderer's
   * "1-level expand" UX. The runtime threads the user's Settings
   * preference here; runners clamp to the shared `MAX_SCOPE_DEPTH`.
   */
  scopeDepth?: number;
  /**
   * implementation — when `true`, the runner asks its worker to ALSO
   * post the run's structured return value (e.g. the notebook's
   * `{ stdout, stderr, sessionDelta }` object) as live data on
   * `ExecutionResult.structuredResult`, bypassing the display-only
   * string serializer that truncates at `MAX_RESULT_BYTES`. Only the
   * notebook session manager sets this; normal runs leave it unset so
   * the extra structured clone + larger postMessage payload never
   * burdens the hot path. Runners that don't implement structured
   * capture ignore the field harmlessly.
   */
  captureStructuredResult?: boolean;
  /**
   * implementation — per-notebook Python kernel scope. When set (the notebook session
   * passes the notebook's tabId), the Python worker runs the cell against a
   * persistent namespace dedicated to that scope, so cells in one notebook
   * share state while staying isolated from the editor scratchpad and other
   * notebooks. Unset = the legacy shared module-`globals()` path (editor
   * scratchpad). Only the Python runner consumes it; other runners ignore it.
   */
  scopeId?: string;
}

export interface ExecutionError {
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  stack?: string;
  /**
   * implementation — structured stack frames parsed by the worker
   * (`parseJsErrorStack` / `parsePythonTraceback`). The renderer reads
   * these to build a `kind: 'error'` payload with clickable frames
   * . Absent when the worker can't parse a stack — the
   * legacy text path still renders the message + location.
   */
  frames?: import('../../shared/errorStack').ClickableStackFrame[];
}

export interface EditorDiagnostic {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  source?: string;
}

export interface MagicCommentResult {
  line: number;
  value: string;
  /**
   * implementation — which magic-comment shape produced
   * this entry. `'arrow'` for the original `//=>` / `#=>` ad-hoc
   * peek; `'watch'` for the `// @watch <expr>` / `# @watch <expr>`
   * pinned watch; `'autoLog'` for the JS / TS bare-expression
   * auto-log surface added in implementation. Runners populate this from
   * `magicCommentKindsByLine(language, source, options)` before
   * dispatch. Optional so a future runner that emits magic results
   * without a transform pass (e.g. a future REPL adapter) doesn't
   * have to backfill the field.
   */
  kind?: 'arrow' | 'watch' | 'autoLog';
  /**
   * implementation — optional structured payload the runner
   * attached after detecting a rich-output directive (`//=> table`)
   * or auto-detecting an array of plain objects. `value` stays the
   * canonical string fallback every renderer surface already reads;
   * `payload` adds the typed companion that the inline pill upgrades
   * to a `Table(N×M)` summary  and the console panel will
   * render as an interactive widget .
   */
  payload?: RichOutputPayload;
}

/**
 * implementation — wall-clock duration of one top-level statement,
 * attributed to the statement's first line. Produced by the worker's
 * `__mc_tick` delta accumulator, batched on a single `line-timing`
 * message right before `done`.
 */
export interface LineTimingEntry {
  /** 1-based line where the statement begins. */
  line: number;
  durationMs: number;
}

export interface ExecutionResult {
  stdout: ConsoleOutput[];
  stderr: ConsoleOutput[];
  result?: unknown;
  executionTime: number;
  /** internal — per-statement timings; present only when instrumented. */
  lineTimings?: LineTimingEntry[];
  /**
   * True when the user explicitly stopped execution. Cancelled runs
   * are not successes and should not be recorded as normal history
   * entries, but they also are not runtime errors in the user's code.
   */
  cancelled?: boolean;
  error?: ExecutionError;
  magicResults?: MagicCommentResult[];
  /**
   * implementation note — stdin consumption summary. Populated by
   * runners whose worker pulled at least one line out of the pre-set
   * buffer; the StdinInputPanel reads this to render
   * "Used N of M line(s)". `total` is the number of lines in the
   * buffer the worker received; `count` is how many lines the
   * program actually read. Omitted entirely when the run didn't
   * touch stdin.
   */
  stdinConsumed?: { count: number; total: number };
  /**
   * implementation — explicit termination kind. The renderer's
   * `<RunStatusPill>` self-gates on this field rather than
   * reverse-engineering the kind from `error.message`. `'success'`
   * is the default when no `error` and no `cancelled` flag fires;
   * `'timeout'` is set by `runnerTimeoutResult`, `'stopped'` by
   * `runnerStoppedResult`, `'error'` by any other thrown / errored
   * path.
   */
  kind?: 'success' | 'error' | 'timeout' | 'stopped';
  /**
   * implementation — when `kind === 'timeout'`, names the preset
   * that fired the limit. `'override'` when the run was driven by
   * an explicit caller timeout (one-shot extended / magic-comment).
   */
  timeoutPreset?: RuntimeTimeoutPreset | 'override';
  /**
   * implementation — the actual timeout in ms that armed the run.
   * Surfaces in the `RunStatusPill` tooltip + the timed-out result
   * message.
   */
  timeoutMs?: number;
  /**
   * implementation — post-execute variable scope captured by the
   * worker. `null` when the runner does not implement capture OR
   * the run errored / timed out / was cancelled. The result store
   * stores the most recent non-null snapshot so the inspector
   * toggle can light up.
   */
  scopeSnapshot?: ScopeSnapshot | null;
  /**
   * implementation — the run's structured return value, posted by the
   * worker when the caller set `ExecutionContext.captureStructuredResult`.
   * Unlike `result` (a display string the worker serializes + truncates
   * at `MAX_RESULT_BYTES`), this carries the live value through the
   * postMessage structured clone, so the notebook's
   * `{ stdout, stderr, sessionDelta }` round-trips losslessly. `undefined`
   * when not requested, when the run errored, or when the value was not
   * structured-cloneable.
   */
  structuredResult?: unknown;
}

export interface ConsoleOutput {
  type: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  line?: number;
  /**
   * implementation — rich payload aligned by index with `args`. The legacy
   * `args` string array still ships as the text fallback for non-JS runners
   * + Settings opt-out + payload-missing edge cases. Renderers must treat
   * this as additive: when absent, fall back to `args`.
   */
  payload?: RichOutputPayload[];
}

/**
 * The runner contract every execution backend implements (JS/TS worker,
 * Pyodide, Go WASM, Rust subprocess, Ruby hybrid, plugin runtimes).
 * `RunnerManager` (`src/renderer/runners/manager.ts`) owns the
 * lifecycle: it lazily constructs one runner per language (or per
 * JS/TS runtime mode), gates execution on `isReady()`, and dedupes
 * concurrent `init()` calls through an in-flight promise map.
 *
 * Contract invariants:
 *
 *  - `init()` is the one-time async boot (toolchain detection, WASM
 *    fetch, worker spawn). It may be called again after a failed boot;
 *    a *throw* marks the runner unavailable and the rejection message
 *    is surfaced to the user (e.g. "Go is not installed").
 *  - `execute()` RESOLVES — it never rejects for user-code failures.
 *    Compile errors, runtime errors, timeouts, and stop() all resolve
 *    with an `ExecutionResult` whose `kind` / `error` describe the
 *    outcome, so callers never need try/catch for user-code paths.
 *  - `stop()` is synchronous, idempotent, and must settle any
 *    in-flight `execute()` with a runner-stopped result (no dangling
 *    promises after termination).
 *  - `isReady()` reports whether `init()` completed; the manager uses
 *    it to decide whether a run must await initialization first.
 */
export interface LanguageRunner {
  /** Stable registry key (usually equal to `language`). */
  id: string;
  /** Human-readable name for status surfaces ("Go", "Python"). */
  name: string;
  /** Language-pack id this runner serves. */
  language: Language;
  /** File extensions associated with the language (".go", ".rs"). */
  extensions: string[];
  init(): Promise<void>;
  execute(code: string, context?: ExecutionContext): Promise<ExecutionResult>;
  stop(): void;
  isReady(): boolean;
}

// internal — the stale `WorkerRequest` union that used to live here is
// gone: nothing imported it, its shape had drifted from what the runner
// actually posts (no `stop` message exists — runners `terminate()`), and
// it silently omitted the debugger-control variants. The REAL inbound
// contract lives at the receiving end: `WorkerInboundMessage` in
// `workers/js-worker-protocol.ts` (= `JsWorkerExecuteMessage` + the shared
// `DebuggerControlMessage` from `runtime/debuggerWorkerBridge`), enforced
// there by an exhaustiveness `never` guard.

/**
 * Messages sent from the worker to the main thread.
 *
 * internal — every `execute` request carries an opaque `runId` minted
 * by the parent. The worker echoes it on every reply so the parent
 * can drop messages from a previous (terminated-by-timeout) run.
 *
 * The `runId` echo lives on every variant tied to a specific
 * `execute` round; lifecycle messages (`loading` / `ready`) leave
 * it optional because they may fire before the first run.
 */
export type WorkerResponse =
  | {
      type: 'console';
      runId: string;
      method: ConsoleOutput['type'];
      args: string[];
      line?: number;
      /**
       * implementation — additive typed payload aligned by index
       * with `args`. Absent from runners that don't emit rich
       * payloads (Python / Go / Rust today); the renderer text path
       * stays the canonical fallback.
       */
      payload?: RichOutputPayload[];
      /**
       * implementation note — adoption signal for `console.table()`.
       * The runner promotes this into a `runtime.console_table_called`
       * telemetry event; never read by the panel.
       */
      consoleTableInvoked?: boolean;
      /**
       * implementation — rich-media helper rejection marker emitted
       * by the JS / Python worker bridges. Runner-side telemetry
       * forwarding (`runtime.rich_media_payload_rejected`) landed in
       * implementation-β-β-α implementation note; all three runners (JS / TS / Python)
       * read this field and fire-and-forget the event.
       */
      richMediaRejected?: {
        kind: 'chart' | 'image' | 'html';
        reason: 'invalid-src' | 'size-limit' | 'validation-failed';
      };
    }
  | {
      type: 'result';
      runId: string;
      value?: unknown;
      /**
       * implementation — structured return value forwarded losslessly
       * via the postMessage structured clone when the execute request
       * set `captureStructuredResult`. The runner threads this onto
       * `ExecutionResult.structuredResult`; absent for normal runs.
       */
      structured?: unknown;
    }
  | {
      type: 'error';
      /**
       * Optional because the Python worker's lifecycle (`init`)
       * branch reports a load failure before any `execute` request
       * has supplied a runId. Active-run errors always include it.
       */
      runId?: string;
      error: ExecutionError;
    }
  | { type: 'done'; runId: string; executionTime: number }
  | { type: 'loading'; stage: string }
  | { type: 'ready' }
  | {
      type: 'magic-comment';
      runId: string;
      line: number;
      value: string;
      /**
       * implementation note — when the source carried a `#=> table`
       * directive, the Python worker computes a forced-table payload
       * alongside the legacy stringified `value`. JS / TS workers
       * currently leave this absent and the renderer recovers a
       * payload client-side via `tryParseJsonForPayload +
       * forceTablePayload`. Renderers must always tolerate absence.
       */
      payload?: RichOutputPayload;
    }
  | {
      /**
       * internal — live download progress while a WASM runtime
       * bootstraps (Pyodide / Ruby). `totalBytes` is null when the
       * server sent no Content-Length (progress is indeterminate).
       * Best-effort: absence of these messages never blocks a boot.
       */
      type: 'bootstrap-progress';
      runId: string;
      loadedBytes: number;
      totalBytes: number | null;
    }
  | {
      /**
       * implementation — batched per-statement timings the worker
       * posts once, right before `done` (and on the error path, for
       * the statements that DID complete). Only present when the
       * runner instrumented the source with `__mc_tick` markers.
       */
      type: 'line-timing';
      runId: string;
      entries: LineTimingEntry[];
    }
  | {
      // implementation — debugger pause from the JS worker. Carries
      // the source line, the locals snapshot, the call stack, and any
      // watch-result placeholders for the UI drawer.
      type: 'paused';
      runId: string;
      line: number;
      reason: 'user-breakpoint' | 'step';
      locals: Record<string, string>;
      callStack: { functionName: string; line: number }[];
      watchResults: Record<string, { value?: string; error?: string; pending?: boolean }>;
      conditionalPending?: boolean;
    }
  | { type: 'resumed'; runId: string }
  | {
      /**
       * implementation note — stdin consumption summary the worker
       * posts right before `done`. `count` is the number of lines the
       * program actually consumed; `total` is the size of the
       * pre-set buffer the worker received. Omitted entirely when
       * the buffer was empty.
       */
      type: 'stdin-consumed';
      runId: string;
      count: number;
      total: number;
    }
  | {
      /**
       * implementation — post-execute scope snapshot. The worker
       * captures `globalThis` (JS) or `globals()` (Python) after the
       * user code resolves, filters internal helpers + boot-time
       * names, and walks each remaining binding via the shared
       * `serializeScopeValue` helper. Posted BEFORE `stdin-consumed`
       * and `done` so the runner can stitch the snapshot onto
       * `ExecutionResult.scopeSnapshot`. `error` is set when capture
       * threw inside the worker — the snapshot is still emitted
       * (with empty `variables`) so the runner's threading stays
       * consistent.
       */
      type: 'scope-snapshot';
      runId: string;
      snapshot: ScopeSnapshot;
      error?: string;
    };

import type {
  DebuggerBreakpointPayload,
  DebuggerControlMessage,
} from '../runtime/debuggerWorkerBridge';

export interface JsWorkerExecuteMessage {
  type: 'execute';
  runId: string;
  code: string;
  resultTruncationMarker?: string;
  debug?: boolean;
  breakpoints?: DebuggerBreakpointPayload[];
  watches?: string[];
  sourceLineMap?: Record<number, number>;
  /**
   * implementation — false disables console-origin stack capture
   * so the worker does not attach `line` / `payload.origin` metadata
   * when the Settings master toggle is off.
   */
  sourceMappingEnabled?: boolean;
  /**
   * implementation — pre-set stdin buffer for `prompt()` /
   * `readline()`. Newline-delimited. Empty / undefined leaves the
   * native worker behavior in place (worker has no `prompt`, so
   * calls throw `ReferenceError`).
   */
  stdin?: string;
  /**
   * implementation — when `true`, capture the post-execute global
   * scope and emit a `'scope-snapshot'` reply before `done`. The
   * runner sets this when the user has the variable inspector
   * toggle on for the active tab (or wants the data eagerly
   * available so the toggle lights up); skipping the capture keeps
   * the hot path cheap when the inspector is off.
   */
  captureScope?: boolean;
  /**
   * implementation note — recursion depth for the scope walker.
   * Defaults to `DEFAULT_SCOPE_DEPTH` (1). `MAX_SCOPE_DEPTH` (4)
   * is the runner-side cap.
   */
  scopeDepth?: number;
  /**
   * implementation — language id stamped on the snapshot. Lets the
   * shared JS worker emit `'typescript'` when invoked by the TS
   * runner.
   */
  scopeLanguage?: string;
  /**
   * implementation — when `true`, ALSO post the structured return
   * value on the `'result'` reply (`structured` field) so the notebook
   * runner round-trips `{ stdout, stderr, sessionDelta }` losslessly
   * instead of parsing the truncated display string. Snapshotted via
   * `safeStructuredResult` (structuredClone → JSON round-trip cascade),
   * so non-serializable leaves drop while serializable siblings survive.
   */
  captureStructuredResult?: boolean;
}

/**
 * internal — every message the JS/TS worker can receive. `execute` starts
 * a run; the debugger-control variants (`resume` / `step` /
 * `set-breakpoints`) reuse the SAME union the sender posts
 * (`DebuggerControlMessage` from `debuggerWorkerBridge`). Asserted once
 * at the message boundary so the handler narrows by `type` with no
 * per-branch casts, and an exhaustiveness `never` check flags any new
 * inbound variant that lacks a handler.
 */
export type JsWorkerInboundMessage = JsWorkerExecuteMessage | DebuggerControlMessage;

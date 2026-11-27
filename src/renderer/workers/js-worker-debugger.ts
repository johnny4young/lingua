import type { JsWorkerExecuteMessage } from './js-worker-protocol';
import type { DebuggerBreakpointPayload } from '../runtime/debuggerWorkerBridge';
import {
  MAX_DEBUGGER_EXPRESSION_LENGTH,
  type DebuggerScopeSnapshot,
} from './debuggerExpression';

const MAX_WORKER_WATCHES = 20;

export function sanitizeJsWorkerWatches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const watches: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const expression = candidate.trim().slice(0, MAX_DEBUGGER_EXPRESSION_LENGTH);
    if (!expression || seen.has(expression)) continue;
    watches.push(expression);
    seen.add(expression);
    if (watches.length >= MAX_WORKER_WATCHES) break;
  }
  return watches;
}

export type JsWorkerStepMode = 'none' | 'over' | 'into' | 'out';

export type JsWorkerBreakpoint = Omit<DebuggerBreakpointPayload, 'line'>;

interface JsWorkerDebuggerFrame {
  functionName: string;
  /** Absent on the top-level frame. */
  declarationLine?: number;
  /** The statement the frame is running: the call site of the frame above it. */
  line: number;
}

/** The top level is the outermost frame, as native runtimes report it; its line is 0 until a statement runs. */
const moduleFrame = (): JsWorkerDebuggerFrame => ({ functionName: '<module>', line: 0 });

export interface JsWorkerDebuggerSession {
  runId: string;
  enabled: boolean;
  breakpoints: Map<number, JsWorkerBreakpoint>;
  watches: string[];
  stepMode: JsWorkerStepMode;
  stepDepth: number;
  frames: JsWorkerDebuggerFrame[];
  /** First line of each statement that ran, mapped to its last line. */
  reached: Map<number, number>;
  resumeResolver: (() => void) | null;
  pausedScope: DebuggerScopeSnapshot | null;
  resultMarker: string;
}

export function createJsWorkerDebuggerSession(runId: string): JsWorkerDebuggerSession {
  return {
    runId,
    enabled: false,
    breakpoints: new Map(),
    watches: [],
    stepMode: 'none',
    stepDepth: 0,
    frames: [moduleFrame()],
    reached: new Map(),
    resumeResolver: null,
    pausedScope: null,
    resultMarker: '',
  };
}

export function applyJsWorkerExecutePayload(
  session: JsWorkerDebuggerSession,
  message: JsWorkerExecuteMessage
): void {
  session.enabled = message.debug === true;
  session.breakpoints.clear();
  if (Array.isArray(message.breakpoints)) {
    for (const breakpoint of message.breakpoints) {
      if (typeof breakpoint.line === 'number' && breakpoint.line > 0) {
        session.breakpoints.set(breakpoint.line, {
          mode:
            breakpoint.mode === 'conditional' || breakpoint.mode === 'logpoint'
              ? breakpoint.mode
              : 'pause',
          condition: breakpoint.condition ?? '',
          logMessage: breakpoint.logMessage ?? '',
        });
      }
    }
  }
  session.watches = sanitizeJsWorkerWatches(message.watches);
  session.stepMode = 'none';
  session.stepDepth = 0;
  session.frames = [moduleFrame()];
  session.reached = new Map();
  session.resumeResolver = null;
  session.pausedScope = null;
}

/** Records the statement about to run as its frame's current line. */
export function noteJsWorkerDebugLine(session: JsWorkerDebuggerSession, line: number): void {
  session.frames.at(-1)!.line = line;
}

/** Records that the statement spanning `line`..`endLine` ran. */
export function reachJsWorkerDebugLines(session: JsWorkerDebuggerSession, line: number, endLine: number): void {
  const known = session.reached.get(line);
  if (known === undefined || known < endLine) session.reached.set(line, endLine);
}

/** The pause's view of the run: frames newest first with their current line, and every line that ran. */
export function jsWorkerPauseFrames(session: JsWorkerDebuggerSession): {
  callStack: JsWorkerDebuggerFrame[];
  reachedLines: number[];
} {
  const reached = new Set<number>();
  for (const [start, end] of session.reached) {
    for (let line = start; line <= end; line += 1) reached.add(line);
  }
  return {
    // Copies, since the frames keep moving after the pause is posted.
    callStack: session.frames.map(frame => ({ ...frame })).reverse(),
    reachedLines: [...reached].sort((a, b) => a - b),
  };
}

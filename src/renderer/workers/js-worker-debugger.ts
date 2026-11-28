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

export interface JsWorkerDebuggerFrame {
  functionName: string;
  /** Absent on the top-level frame. */
  declarationLine?: number;
  /** The statement the frame is running: the call site of the frame above it. */
  line: number;
  /** Which call of this function on the caller's statement it is, from 1, in the order the calls started. */
  callIndex?: number;
  /** Calls started per function name by the statement this frame is running. */
  calls?: Map<string, number>;
  /** Every statement line this invocation has started. */
  ran?: Set<number>;
  /** The frame that was running when this one was called; absent on the top level. */
  parent?: JsWorkerDebuggerFrame;
}

/** The top level is the outermost frame, as native runtimes report it; its line is 0 until a statement runs. */
const moduleFrame = (): JsWorkerDebuggerFrame => ({ functionName: '<module>', line: 0 });

type JsWorkerRunState = Pick<
  JsWorkerDebuggerSession,
  'stepMode' | 'stepFrame' | 'root' | 'active' | 'minted' | 'reached' | 'resumeResolver' | 'held' | 'pausedScope'
>;

/** What each run starts from; nothing of a previous run's frames, steps or pauses carries over. */
function freshRunState(): JsWorkerRunState {
  const root = moduleFrame();
  return {
    stepMode: 'none',
    stepFrame: null,
    root,
    active: root,
    minted: new WeakSet(),
    reached: new Map(),
    resumeResolver: null,
    held: Promise.resolve(),
    pausedScope: null,
  };
}

export interface JsWorkerDebuggerSession {
  runId: string;
  enabled: boolean;
  breakpoints: Map<number, JsWorkerBreakpoint>;
  watches: string[];
  stepMode: JsWorkerStepMode;
  /** The frame a step started from; a sibling call at the same depth is not where it lands. */
  stepFrame: JsWorkerDebuggerFrame | null;
  /** The top level; every call's frame chains up to it through `parent`. */
  root: JsWorkerDebuggerFrame;
  /** The frame whose statement ran last, the caller of the next frame entered. */
  active: JsWorkerDebuggerFrame;
  /** Frames the worker handed out as tokens, so a token from user code cannot pose as one. */
  minted: WeakSet<JsWorkerDebuggerFrame>;
  /** First line of each statement that ran, mapped to its last line. */
  reached: Map<number, number>;
  resumeResolver: (() => void) | null;
  /** Settles once the latest pause resumes; a call that reaches a pause meanwhile waits on it. */
  held: Promise<void>;
  pausedScope: DebuggerScopeSnapshot | null;
  resultMarker: string;
}

export function createJsWorkerDebuggerSession(runId: string): JsWorkerDebuggerSession {
  return {
    runId,
    enabled: false,
    breakpoints: new Map(),
    watches: [],
    ...freshRunState(),
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
  Object.assign(session, freshRunState());
}

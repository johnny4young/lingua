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

export interface JsWorkerDebuggerSession {
  runId: string;
  enabled: boolean;
  breakpoints: Map<number, Omit<DebuggerBreakpointPayload, 'line'>>;
  watches: string[];
  stepMode: JsWorkerStepMode;
  stepDepth: number;
  frames: { functionName: string; line: number }[];
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
    frames: [],
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
  session.frames = [];
  session.resumeResolver = null;
  session.pausedScope = null;
}

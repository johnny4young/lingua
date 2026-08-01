import type { JsWorkerExecuteMessage } from './js-worker-protocol';

export type JsWorkerStepMode = 'none' | 'over' | 'into' | 'out';

export interface JsWorkerDebuggerSession {
  runId: string;
  enabled: boolean;
  breakpoints: Map<number, { condition: string }>;
  watches: string[];
  stepMode: JsWorkerStepMode;
  stepDepth: number;
  frames: { functionName: string; line: number }[];
  resumeResolver: (() => void) | null;
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
          condition: breakpoint.condition ?? '',
        });
      }
    }
  }
  session.watches = Array.isArray(message.watches) ? message.watches : [];
  session.stepMode = 'none';
  session.stepDepth = 0;
  session.frames = [];
  session.resumeResolver = null;
}

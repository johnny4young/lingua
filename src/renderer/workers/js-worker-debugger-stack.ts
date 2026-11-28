import type { JsWorkerDebuggerFrame, JsWorkerDebuggerSession } from './js-worker-debugger';
import { noteJsWorkerDebugLine, reachJsWorkerDebugLines } from './js-worker-debugger-frames';

// Each call's frame chains to its caller, and the instrumented code passes its frame as a token,
// so interleaved async calls keep their own lines and leave by identity, never by stack order.
// A frame suspends at every statement's yield, handing control to its caller or the event loop,
// and is active again once `at` runs on resume.

/** The frame a token names when the worker minted it; the top level otherwise, as for the reach call's 1. */
export function jsWorkerDebugFrame(session: JsWorkerDebuggerSession, token: unknown): JsWorkerDebuggerFrame {
  return typeof token === 'object' && token !== null && session.minted.has(token as JsWorkerDebuggerFrame)
    ? (token as JsWorkerDebuggerFrame)
    : session.root;
}

/** Whether the armed step pauses on a statement of `frame`: any for into, the stepped frame or a caller of it for over, only a caller for out. */
export function jsWorkerStepPauses(session: JsWorkerDebuggerSession, frame: JsWorkerDebuggerFrame): boolean {
  if (session.stepMode === 'into') return true;
  if (session.stepMode === 'none') return false;
  const stepped = session.stepFrame ?? session.root;
  for (let at = session.stepMode === 'out' ? stepped.parent : stepped; at; at = at.parent) if (at === frame) return true;
  return false;
}

/** Enters a function frame under the active one, counting it among the calls its caller's statement has started; returns its token. */
function pushJsWorkerDebugFrame(session: JsWorkerDebuggerSession, functionName: string, line: number): JsWorkerDebuggerFrame {
  const caller = session.active;
  const calls = (caller.calls ??= new Map());
  const callIndex = (calls.get(functionName) ?? 0) + 1;
  calls.set(functionName, callIndex);
  const frame: JsWorkerDebuggerFrame = { functionName, declarationLine: line, line, callIndex, parent: caller };
  session.minted.add(frame);
  session.active = frame;
  return frame;
}

/** Leaves the frame a token names; control returns to its caller only when that frame was the active one. */
function popJsWorkerDebugFrame(session: JsWorkerDebuggerSession, token: unknown): void {
  const frame = jsWorkerDebugFrame(session, token);
  if (frame !== session.root && session.active === frame) session.active = frame.parent ?? session.root;
}

/** The helpers the debug instrumentation calls besides the yield: enter, leave, reach and resume a frame. */
export function createJsWorkerDebugHelpers(session: JsWorkerDebuggerSession) {
  return {
    frame: (functionName: string, line: number) => pushJsWorkerDebugFrame(session, functionName, line),
    pop: (token: unknown) => popJsWorkerDebugFrame(session, token),
    // `owner`: 0 for a body without a frame, 1 for the top level, else the body's frame token.
    reach: (line: number, endLine: number, owner: unknown) => {
      if (!session.enabled) return;
      if (owner) noteJsWorkerDebugLine(session, line, jsWorkerDebugFrame(session, owner));
      reachJsWorkerDebugLines(session, line, endLine);
    },
    at: (token: unknown) => {
      if (session.enabled) session.active = jsWorkerDebugFrame(session, token);
    },
  };
}

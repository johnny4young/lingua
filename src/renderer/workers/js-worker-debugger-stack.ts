import type { JsWorkerDebuggerFrame, JsWorkerDebuggerSession } from './js-worker-debugger';
import { noteJsWorkerDebugLine, reachJsWorkerDebugLines } from './js-worker-debugger-frames';

// Each call's frame chains to its caller. Instrumented code holds only a frozen token for it, so interleaved
// async calls keep their own lines and leave by identity, and user code cannot reach the frame itself.
// A frame suspends at each yield or await and is active again once `at` runs on resume.

/** The frame a token names while its call runs; the top level otherwise, as for the reach call's 1. */
export function jsWorkerDebugFrame(session: JsWorkerDebuggerSession, token: unknown): JsWorkerDebuggerFrame {
  return (typeof token === 'object' && token !== null && session.frames.get(token)) || session.root;
}

/** Whether the armed step pauses on a statement of `frame`: any for into, the stepped frame or a caller of it for over, only a caller for out. */
export function jsWorkerStepPauses(session: JsWorkerDebuggerSession, frame: JsWorkerDebuggerFrame): boolean {
  if (session.stepMode === 'into') return true;
  if (session.stepMode === 'none') return false;
  const stepped = session.stepFrame ?? session.root;
  // Once the stepped call returned, step over also lands in the next call a caller starts, such as a loop's next pass.
  const returned = session.stepMode === 'over' && stepped.returned === true;
  for (let at = session.stepMode === 'out' ? stepped.parent : stepped; at; at = at.parent) {
    if (at === frame || (returned && at !== stepped && at === frame.parent)) return true;
  }
  return false;
}

/** Runs `pause` now when no other pause holds the run, else once the held ones resume, so one resolver waits at a time. */
export function holdJsWorkerPause(session: JsWorkerDebuggerSession, pause: () => Promise<void>): Promise<void> {
  const run = session.waiting > 0 ? session.held.then(pause) : pause();
  session.waiting += 1;
  session.held = run.catch(() => undefined).finally(() => (session.waiting -= 1));
  return run;
}

function pushJsWorkerDebugFrame(session: JsWorkerDebuggerSession, functionName: string, line: number): object {
  const caller = session.active;
  const calls = (caller.calls ??= new Map());
  const callIndex = (calls.get(functionName) ?? 0) + 1;
  calls.set(functionName, callIndex);
  const frame: JsWorkerDebuggerFrame = { functionName, declarationLine: line, line, callIndex, parent: caller };
  const token = Object.freeze({});
  session.frames.set(token, frame);
  session.active = frame;
  return token;
}

/** The helpers the debug instrumentation calls besides the yield: enter, leave, reach and resume a frame. */
export function createJsWorkerDebugHelpers(session: JsWorkerDebuggerSession) {
  return {
    frame: (functionName: string, line: number) => pushJsWorkerDebugFrame(session, functionName, line),
    // Control returns to the caller only when the leaving frame was the active one.
    pop: (token: unknown) => {
      const frame = jsWorkerDebugFrame(session, token);
      if (frame === session.root) return;
      frame.returned = true;
      session.frames.delete(token as object);
      if (session.active === frame) session.active = frame.parent ?? session.root;
    },
    // `owner`: 0 for a body without a frame, 1 for the top level, else the body's frame token.
    reach: (line: number, endLine: number, owner: unknown) => {
      if (!session.enabled) return;
      if (owner) noteJsWorkerDebugLine(session, line, jsWorkerDebugFrame(session, owner));
      reachJsWorkerDebugLines(session, line, endLine);
    },
    // Wraps a yield or an await: `token` is the frame that resumes, the awaited value itself for a yield.
    at: <T>(value: T, token: unknown = value): T => {
      if (session.enabled) session.active = jsWorkerDebugFrame(session, token);
      return value;
    },
  };
}

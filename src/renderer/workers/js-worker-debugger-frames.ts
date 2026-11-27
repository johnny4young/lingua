import type { UnassignedBinding } from '../../shared/scopeSnapshot';
import type { JsWorkerDebuggerFrame, JsWorkerDebuggerSession } from './js-worker-debugger';

/** Records the statement about to run as its frame's current line, and as a line the frame ran. */
export function noteJsWorkerDebugLine(session: JsWorkerDebuggerSession, line: number): void {
  const frame = session.frames.at(-1)!;
  frame.line = line;
  (frame.ran ??= new Set()).add(line);
  frame.calls?.clear();
}

/** Enters a function frame, counting it among the calls its caller's statement has started. */
export function pushJsWorkerDebugFrame(session: JsWorkerDebuggerSession, functionName: string, line: number): void {
  const calls = (session.frames.at(-1)!.calls ??= new Map());
  const callIndex = (calls.get(functionName) ?? 0) + 1;
  calls.set(functionName, callIndex);
  session.frames.push({ functionName, declarationLine: line, line, callIndex });
}

/** The paused frame's locals, or none when reading them throws. */
export function readJsWorkerLocals(getLocals: () => Record<string, unknown>): Record<string, unknown> {
  try {
    return getLocals();
  } catch {
    return {};
  }
}

/** The bindings the instrumenter listed as not run yet, or none when the list is missing or unreadable. */
export function parseJsWorkerUnassigned(listed: string | undefined): UnassignedBinding[] | undefined {
  if (!listed) return undefined;
  try {
    const parsed: unknown = JSON.parse(listed);
    return Array.isArray(parsed) ? (parsed as UnassignedBinding[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Records that the statement spanning `line`..`endLine` ran. */
export function reachJsWorkerDebugLines(session: JsWorkerDebuggerSession, line: number, endLine: number): void {
  const known = session.reached.get(line);
  if (known === undefined || known < endLine) session.reached.set(line, endLine);
}

/** The pause's view of the run: frames newest first with their current line, every line that ran, and the paused frame's own. */
export function jsWorkerPauseFrames(session: JsWorkerDebuggerSession): {
  callStack: Omit<JsWorkerDebuggerFrame, 'calls' | 'ran'>[];
  reachedLines: number[];
  frameLines: number[];
} {
  const reached = new Set<number>();
  for (const [start, end] of session.reached) {
    for (let line = start; line <= end; line += 1) reached.add(line);
  }
  const paused = session.frames.at(-1)!;
  return {
    // Copies, since the frames keep moving after the pause is posted.
    callStack: session.frames.map(({ calls: _calls, ran: _ran, ...frame }) => frame).reverse(),
    reachedLines: [...reached].sort((a, b) => a - b),
    frameLines: [...(paused.ran ?? [])].filter(line => line !== paused.line).sort((a, b) => a - b),
  };
}

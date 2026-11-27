import type { PausedFrame } from '../stores/debuggerStore';

type StackFrame = PausedFrame['callStack'][number];

/** One row of the call stack drawn outermost first; `line` is absent where the runtime reports none. */
export interface StackRow {
  readonly functionName: string;
  readonly line?: number;
}

/** The paused call stack outermost first, each row at the line its frame is running. */
export function stackRows(callStack: readonly StackFrame[]): StackRow[] {
  return [...callStack].reverse().map(({ functionName, line }) => (line > 0 ? { functionName, line } : { functionName }));
}

/** How many calls deep the paused frame is; the outermost frame is depth 0. */
export function pauseDepth(callStack: readonly StackFrame[]): number {
  return Math.max(0, callStack.length - 1);
}

/** The function the pause is in, or '' at the top level (`<module>`). */
export function pausedFunctionName(rows: readonly StackRow[]): string {
  const name = rows.at(-1)?.functionName ?? '';
  return name === '<module>' ? '' : name;
}

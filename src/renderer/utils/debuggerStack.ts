import type { PausedFrame } from '../stores/debuggerStore';

type StackFrame = PausedFrame['callStack'][number];

/** One row of the call stack drawn outermost first; `line` is absent where the runtime reports none. */
export interface StackRow {
  readonly functionName: string;
  readonly line?: number;
}

/**
 * The paused call stack outermost first. The JS worker reports function frames
 * only, so its top level gets a row of its own; native runtimes already report
 * their outermost frame.
 */
export function stackRows(callStack: readonly StackFrame[], runtime: string | null | undefined): StackRow[] {
  const rows: StackRow[] = [...callStack].reverse().map(({ functionName, line }) => ({ functionName, line }));
  return runtime === 'js' ? [{ functionName: '' }, ...rows] : rows;
}

/** How many calls deep the paused frame is; the outermost frame is depth 0. */
export function pauseDepth(callStack: readonly StackFrame[], runtime: string | null | undefined): number {
  return Math.max(0, callStack.length - (runtime === 'js' ? 0 : 1));
}

/** The function the pause is in, or '' at the top level (JS top level, Python's module). */
export function pausedFunctionName(rows: readonly StackRow[]): string {
  const name = rows.at(-1)?.functionName ?? '';
  return name === '<module>' ? '' : name;
}

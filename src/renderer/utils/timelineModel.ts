import type { TimelineStep } from '../../shared/timeline';

export type TimelineMove = 'into' | 'over' | 'out';

const depthOf = (step: TimelineStep): number => Math.max(0, step.frames.length - 1);

/**
 * The step a move reaches, or null when none can: Into is the next step, Over
 * skips deeper calls, Out leaves the current call. Backward moves mirror them.
 */
export function findTimelineStep(steps: readonly TimelineStep[], from: number, move: TimelineMove, backward: boolean): number | null {
  const origin = steps[from];
  if (!origin) return null;
  const direction = backward ? -1 : 1;
  if (move === 'into') return steps[from + direction] ? from + direction : null;
  const depth = depthOf(origin);
  if (move === 'out' && depth === 0) return null;
  for (let index = from + direction; index >= 0 && index < steps.length; index += direction) {
    const reached = depthOf(steps[index]!);
    if (move === 'over' ? reached <= depth : reached < depth) return index;
  }
  return null;
}

export interface TimelineEchoes {
  /** Every step that ran the same line, in order. */
  indices: number[];
  /** 1-based position of the selected step among them. */
  position: number;
}

export function timelineEchoes(steps: readonly TimelineStep[], index: number): TimelineEchoes {
  const line = steps[index]?.line;
  const indices = line === undefined ? [] : steps.flatMap((step, at) => (step.line === line ? [at] : []));
  return { indices, position: indices.indexOf(index) + 1 };
}

/**
 * What the selected step's line changed: values that differ at the next step
 * in the same call. Empty when the line returned, threw or ended the run.
 */
export function timelineLineChanges(steps: readonly TimelineStep[], index: number): Array<[string, string]> {
  const step = steps[index];
  const next = findTimelineStep(steps, index, 'over', false);
  if (!step || next === null || depthOf(steps[next]!) !== depthOf(step)) return [];
  const before = new Map(step.vars);
  return steps[next]!.vars.filter(([name, value]) => before.get(name) !== value);
}

/** Lines the run reaches later but has not reached by the selected step. */
export function timelineUnreachedLines(steps: readonly TimelineStep[], index: number): number[] {
  const reached = new Set<number>();
  for (let at = 0; at <= index && at < steps.length; at += 1) reached.add(steps[at]!.line);
  const later = new Set<number>();
  for (let at = index + 1; at < steps.length; at += 1) {
    const line = steps[at]!.line;
    if (line > 0 && !reached.has(line)) later.add(line);
  }
  return [...later].sort((a, b) => a - b);
}

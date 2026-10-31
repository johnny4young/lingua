import { describe, expect, it } from 'vitest';
import type { TimelineStep } from '../../src/shared/timeline';
import {
  findTimelineStep,
  timelineEchoes,
  timelineLineChanges,
  timelineUnreachedLines,
} from '../../src/renderer/utils/timelineModel';

// quickSort-like run: module line 10, call at 11 into a function (lines 2-4) that recurses once.
const at = (line: number, depth: number, vars: Array<[string, string]> = []): TimelineStep => ({
  line,
  frames: Array.from({ length: depth + 1 }, (_, i) => ({ name: i === 0 ? '<module>' : 'f', line })),
  vars,
});
const steps: TimelineStep[] = [
  at(10, 0),
  at(11, 0),
  at(2, 1, [['arr', '[ 3, 1 ]']]),
  at(3, 1, [['arr', '[ 3, 1 ]']]),
  at(2, 2, [['arr', '[]']]),
  at(4, 1, [['arr', '[ 3, 1 ]'], ['pivot', '1']]),
  at(12, 0),
];

describe('timeline model', () => {
  it('steps into, over and out of calls, backward and forward', () => {
    expect(findTimelineStep(steps, 3, 'into', false)).toBe(4);
    expect(findTimelineStep(steps, 3, 'over', false)).toBe(5);
    expect(findTimelineStep(steps, 3, 'out', false)).toBe(6);
    expect(findTimelineStep(steps, 5, 'over', true)).toBe(3);
    expect(findTimelineStep(steps, 4, 'out', true)).toBe(3);
    expect(findTimelineStep(steps, 1, 'out', true)).toBeNull();
    expect(findTimelineStep(steps, 6, 'into', false)).toBeNull();
    expect(findTimelineStep(steps, 0, 'into', true)).toBeNull();
    expect(findTimelineStep([], 0, 'over', false)).toBeNull();
  });

  it('finds the other runs of the line and where the selected one sits', () => {
    expect(timelineEchoes(steps, 4)).toEqual({ indices: [2, 4], position: 2 });
    expect(timelineEchoes(steps, 0)).toEqual({ indices: [0], position: 1 });
  });

  it('reports what the line changed in the same call, and nothing when it returned', () => {
    expect(timelineLineChanges(steps, 3)).toEqual([['pivot', '1']]);
    expect(timelineLineChanges(steps, 4)).toEqual([]);
    expect(timelineLineChanges(steps, 6)).toEqual([]);
  });

  it('keeps sibling calls apart and uses the recorded depth past the frame cap', () => {
    const call = (line: number, id: number, vars: Array<[string, string]>): TimelineStep => ({ ...at(line, 1, vars), call: id });
    const siblings = [at(10, 0), call(2, 1, [['arr', '[ 1 ]']]), call(2, 2, [['arr', '[ 8, 10 ]']]), at(11, 0)];
    expect(timelineLineChanges(siblings, 1)).toEqual([]);
    const deep = (line: number, depth: number): TimelineStep => ({ ...at(line, Math.min(depth, 15)), depth });
    const recursion = [deep(1, 17), deep(2, 18), deep(3, 17), deep(4, 16)];
    expect(findTimelineStep(recursion, 0, 'over', false)).toBe(2);
    expect(findTimelineStep(recursion, 2, 'out', false)).toBe(3);
  });

  it('lists the lines the run reaches later but not yet', () => {
    expect(timelineUnreachedLines(steps, 1)).toEqual([2, 3, 4, 12]);
    expect(timelineUnreachedLines(steps, 2)).toEqual([3, 4, 12]);
    expect(timelineUnreachedLines(steps, 5)).toEqual([12]);
    expect(timelineUnreachedLines(steps, 6)).toEqual([]);
  });
});

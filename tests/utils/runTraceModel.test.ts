import { describe, expect, it } from 'vitest';
import { detectLoops, lineTimes, pickLoops, pickTicks, sampleSteps, slowestLine } from '@/utils/runTraceModel';
import type { TimelineStep } from '@/../shared/timeline';

const at = (line: number, extra: Partial<TimelineStep> = {}): TimelineStep => ({ line, frames: [], vars: [], call: 0, depth: 0, ...extra });
const run = (lines: number[]): TimelineStep[] => lines.map(line => at(line));

describe('line times', () => {
  it('gives each step the time until the next one, and the last until the run ended', () => {
    const steps = [at(1, { ms: 0 }), at(2, { ms: 10 }), at(1, { ms: 15 }), at(3, { ms: 40 })];
    expect([...lineTimes(steps, 100)!]).toEqual([[1, 35], [2, 5], [3, 60]]);
  });

  it('keeps time spent inside a call on the lines of the callee', () => {
    const steps = [
      at(5, { ms: 0 }),
      at(1, { ms: 2, call: 1, depth: 1 }),
      at(2, { ms: 4, call: 1, depth: 1 }),
      at(6, { ms: 54 }),
    ];
    expect([...lineTimes(steps, 60)!]).toEqual([[5, 2], [1, 2], [2, 50], [6, 6]]);
    expect(slowestLine(steps, 60)).toEqual({ line: 2, ms: 50, total: 60, share: 50 / 60 });
    // Setup before the first step counts toward the run, not toward a line.
    expect(slowestLine(steps.map(step => ({ ...step, ms: step.ms! + 20 })), 80)).toEqual({ line: 2, ms: 50, total: 80, share: 50 / 80 });
  });

  it('has no answer without a full clock or when no time passed', () => {
    expect(lineTimes([at(1, { ms: 0 }), at(2)], 10)).toBeNull();
    expect(lineTimes([at(1, { ms: 0 })], undefined)).toBeNull();
    expect(slowestLine([at(1, { ms: 3 }), at(2, { ms: 3 })], 3)).toBeNull();
  });
});

describe('loop detection', () => {
  it('reads three passes off the jumps back to the same line', () => {
    const [loop, ...rest] = detectLoops(run([1, 2, 3, 4, 3, 4, 3, 4, 5]));
    expect(rest).toEqual([]);
    expect(loop).toEqual({
      head: 3,
      passes: [{ start: 2, end: 3 }, { start: 4, end: 5 }, { start: 6, end: 7 }],
      start: 2,
      end: 7,
      minLine: 3,
      maxLine: 4,
    });
  });

  it('keeps a call made by the body inside its pass', () => {
    const inner = (line: number, call: number) => at(line, { call, depth: 1 });
    const loops = detectLoops([at(3), at(4), inner(10, 1), inner(9, 1), at(3), at(4), inner(10, 2), at(6)]);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.passes).toEqual([{ start: 0, end: 3 }, { start: 4, end: 5 }]);
    expect(loops[0]!.maxLine).toBe(10);
  });

  it('skips a loop nested in one already drawn and keeps at most three', () => {
    const nested = detectLoops(run([1, 2, 3, 2, 3, 1, 2, 3, 2, 3, 4]));
    expect(nested.map(loop => loop.head).sort()).toEqual([1, 2, 2]);
    expect(pickLoops(nested).map(loop => loop.head)).toEqual([1]);
    const four = detectLoops(run([1, 2, 1, 2, 3, 4, 3, 4, 5, 6, 5, 6, 7, 8, 7, 8, 9]));
    expect(pickLoops(four).map(loop => loop.head)).toEqual([1, 3, 5]);
  });

  it('does not call one visit a loop', () => {
    expect(detectLoops(run([1, 2, 3, 4]))).toEqual([]);
  });
});

describe('ticks and sampling', () => {
  it('drops a label closer than the gap to the one before it', () => {
    expect(pickTicks([5, 1, 2, 5, 9, 10], line => line * 5)).toEqual([1, 5, 9]);
  });

  it('samples evenly but keeps log, error, selected and last steps', () => {
    const steps = run(Array.from({ length: 100 }, (_, index) => index + 1));
    steps[13] = at(14, { log: 'log' });
    steps[27] = at(28, { error: true });
    const drawn = sampleSteps(steps, 41, 10);
    expect(drawn).toEqual([0, 10, 13, 20, 27, 30, 40, 41, 50, 60, 70, 80, 90, 99]);
    expect(sampleSteps(steps, 0, 100)).toHaveLength(100);
  });
});

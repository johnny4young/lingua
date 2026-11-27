import { describe, expect, it } from 'vitest';
import { RUNNING_SHOWN_MS, enclosingLoop, liveLineAnswers, liveLineMs, loopTotalsKey } from '@/components/Editor/liveLineModel';

const snapshot = { line: 4, lineMs: 100, elapsedMs: 900, loops: [] };

describe('live line answers', () => {
  it('ticks the time on the line from the snapshot, never past a sleep', () => {
    expect(liveLineMs(snapshot, 1_000, 1_250)).toBe(350);
    expect(liveLineMs({ ...snapshot, waitMs: 400 }, 1_000, 2_000)).toBe(400);
    expect(liveLineMs(snapshot, 1_000, 900)).toBe(100);
  });

  it('answers each open loop on its header, the innermost when a header repeats, and RUNNING once a line holds the run', () => {
    const live = {
      ...snapshot,
      loops: [
        { line: 1, pass: 2, total: 3, binding: { name: 'name', value: "'db'" } },
        { line: 2, pass: 0 },
        { line: 1, pass: 1, total: 3 },
      ],
    };
    expect(liveLineAnswers(live, RUNNING_SHOWN_MS - 1)).toEqual([{ line: 1, kind: 'loop', pass: 1, total: 3 }]);
    expect(liveLineAnswers({ ...live, line: 1 }, RUNNING_SHOWN_MS)).toEqual([{ line: 1, kind: 'running', lineMs: RUNNING_SHOWN_MS }]);
    expect(liveLineAnswers({ ...live, loops: live.loops.slice(0, 1) }, 310)).toEqual([
      { line: 1, kind: 'loop', pass: 2, total: 3, binding: { name: 'name', value: "'db'" } },
      { line: 4, kind: 'running', lineMs: 310 },
    ]);
  });

  it('reads the total of the innermost open loop whose body holds the line, keyed so a moving line keeps the key', () => {
    const live = { ...snapshot, loops: [{ line: 1, end: 6, pass: 1, total: 3 }, { line: 3, end: 4, pass: 2 }, { line: 8, pass: 1, total: 2 }] };
    const key = loopTotalsKey(live);
    expect(key).toBe('1:6:3:1,3:4:-:2');
    expect(loopTotalsKey({ ...live, line: 5, lineMs: 900 })).toBe(key);
    expect(enclosingLoop(key, 2)).toEqual({ total: 3, pass: 1 });
    expect(enclosingLoop(key, 5)).toEqual({ total: 3, pass: 1 });
    // Inside a loop with no total, the outer loop's total does not count its passes.
    expect(enclosingLoop(key, 4)).toBeUndefined();
    expect(enclosingLoop(key, 1)).toBeUndefined();
    expect(enclosingLoop(key, 7)).toBeUndefined();
    expect(enclosingLoop('', 2)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { LIVE_RUN_MAX_LOOPS, livePassField, mapLiveRunLines, sanitizeLiveRun } from '@/../shared/liveRun';
import { reportLiveRun, useLiveRunStore } from '@/stores/liveRunStore';

describe('live run protocol', () => {
  it('keeps the known fields of a snapshot and ignores ones a newer worker adds', () => {
    expect(
      sanitizeLiveRun({ line: 4, lineMs: 12.5, elapsedMs: 40, loops: [{ line: 2, pass: 1, total: 3, extra: 1 }], waitMs: 400, frame: 'new' })
    ).toEqual({ line: 4, lineMs: 12.5, elapsedMs: 40, loops: [{ line: 2, pass: 1, total: 3 }], waitMs: 400 });
  });

  it('drops what user code could have forged', () => {
    expect(sanitizeLiveRun(null)).toBeUndefined();
    expect(sanitizeLiveRun({ line: 0 })).toBeUndefined();
    expect(sanitizeLiveRun({ line: 2, lineMs: -1, elapsedMs: Number.NaN, loops: 'x', waitMs: Infinity })).toEqual({
      line: 2,
      lineMs: 0,
      elapsedMs: 0,
      loops: [],
    });
    const loops = Array.from({ length: LIVE_RUN_MAX_LOOPS + 3 }, (_, index) => ({ line: index + 1, pass: 1 }));
    expect(sanitizeLiveRun({ line: 1, loops: [...loops, { line: 1, pass: 1.5 }, null] })?.loops).toEqual(loops.slice(3));
    expect([livePassField(3), livePassField(0), livePassField(-1), livePassField('2')]).toEqual([{ pass: 3 }, { pass: 0 }, {}, {}]);
  });

  it('maps lines back to the source and drops loops that do not map', () => {
    const live = { line: 5, lineMs: 1, elapsedMs: 2, loops: [{ line: 3, pass: 1 }, { line: 9, pass: 2 }] };
    const map = (line: number) => ({ 5: 4, 3: 2 } as Record<number, number>)[line];
    expect(mapLiveRunLines(live, map)).toEqual({ ...live, line: 4, loops: [{ line: 2, pass: 1 }] });
    expect(mapLiveRunLines(live, () => undefined)).toBeUndefined();
  });
});

describe('live run store', () => {
  it('keeps one snapshot per tab and clears only for the run that owns it', () => {
    const live = { line: 1, lineMs: 0, elapsedMs: 0, loops: [] };
    const { publish, clear } = useLiveRunStore.getState();
    publish('a', 'run-1', live);
    publish('b', 'run-2', live);
    clear('a', 'run-old');
    expect(Object.keys(useLiveRunStore.getState().byTab)).toEqual(['a', 'b']);
    clear('a', 'run-1');
    expect(Object.keys(useLiveRunStore.getState().byTab)).toEqual(['b']);
    clear('b', 'run-2');
  });

  it('reports one run per tab and ends only its own snapshot', () => {
    const live = { line: 2, lineMs: 1, elapsedMs: 60, loops: [] };
    const first = reportLiveRun('tab');
    const second = reportLiveRun('tab');
    first.onLive(live);
    second.onLive({ ...live, line: 3 });
    first.end();
    expect(useLiveRunStore.getState().byTab['tab']?.live.line).toBe(3);
    second.end();
    expect(useLiveRunStore.getState().byTab['tab']).toBeUndefined();
  });
});

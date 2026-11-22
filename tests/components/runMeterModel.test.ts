import { describe, expect, it } from 'vitest';
import { meterBars, meterState } from '@/components/RunMeter/runMeterModel';
import { formatCountdown, formatRunDuration, splitRunDuration } from '@/utils/timeLabels';
import type { TabRun } from '@/stores/resultStore';

const ok = (number: number, durationMs: number): TabRun => ({ number, kind: 'success', durationMs });

describe('runMeterModel', () => {
  it('ranks paused over running over stale', () => {
    const last = ok(1, 4);
    expect(meterState({ running: true, paused: true, stale: false, last })).toBe('paused');
    expect(meterState({ running: true, paused: false, stale: true, last })).toBe('running');
    expect(meterState({ running: false, paused: false, stale: true, last })).toBe('stale');
    expect(meterState({ running: false, paused: false, stale: false, last: null })).toBe('idle');
    expect(meterState({ running: false, paused: false, stale: false, last: { ...last, kind: 'timeout' } })).toBe('timeout');
    expect(meterState({ running: false, paused: false, stale: false, last })).toBe('done');
  });

  it('splits durations on the same thresholds the formatted duration uses', () => {
    expect(splitRunDuration(null)).toEqual({ value: '—', unit: null });
    expect(splitRunDuration(1.12)).toEqual({ value: '1.1', unit: 'ms' });
    expect(splitRunDuration(412.4)).toEqual({ value: '412', unit: 'ms' });
    expect(splitRunDuration(1150)).toEqual({ value: '1.15', unit: 's' });
    expect(formatRunDuration(1150)).toBe('1.15 s');
    expect(formatRunDuration(null)).toBe('—');
  });

  it('keeps the newest seven runs on a square-root scale with stubs for failures', () => {
    const runs = [ok(1, 100), ...Array.from({ length: 7 }, (_, index) => ok(index + 2, 400)), { number: 9, kind: 'error', durationMs: 2 } as TabRun];
    const bars = meterBars(runs, null);
    expect(bars.map(bar => bar.number)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(bars.at(-1)).toMatchObject({ kind: 'error', height: 0, latest: true });
    expect(bars[0]!.height).toBe(1);
    expect(meterBars([ok(1, 100), ok(2, 400)], null)[0]!.height).toBeCloseTo(0.5);
  });

  it('puts the live run last, filling toward the previous run', () => {
    const bars = meterBars([ok(1, 400)], { number: 2, elapsedMs: 100 });
    expect(bars.at(-1)).toMatchObject({ number: 2, kind: 'live', latest: true, expected: 1 });
    expect(bars.at(-1)!.height).toBeCloseTo(0.5);
    expect(bars[0]!.latest).toBe(false);
    expect(meterBars(Array.from({ length: 9 }, (_, index) => ok(index + 1, 4)), { number: 10, elapsedMs: 1 })).toHaveLength(7);
  });

  it('formats the countdown as m:ss', () => {
    expect(formatCountdown(65_400)).toBe('1:05');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

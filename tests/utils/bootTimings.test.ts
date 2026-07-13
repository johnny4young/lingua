import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyBootTimingsToClipboard,
  getBootTimings,
  markBootPhase,
  resetBootTimingsForTesting,
  startBootTiming,
} from '../../src/renderer/utils/bootTimings';

describe('bootTimings (IT2-G1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetBootTimingsForTesting();
  });

  it('records ordered duration-only phases and ignores duplicate marks', () => {
    const now = vi.spyOn(performance, 'now');
    for (const value of [0, 20, 30, 45, 70, 100]) now.mockReturnValueOnce(value);

    resetBootTimingsForTesting();
    startBootTiming();
    markBootPhase('system-language');
    markBootPhase('system-language');
    markBootPhase('i18n');
    markBootPhase('react-mount');
    markBootPhase('first-paint');
    markBootPhase('rehydration');

    expect(getBootTimings()).toEqual({
      version: 1,
      totalDurationMs: 100,
      phases: [
        { phase: 'system-language', durationMs: 20 },
        { phase: 'i18n', durationMs: 10 },
        { phase: 'react-mount', durationMs: 15 },
        { phase: 'first-paint', durationMs: 25 },
        { phase: 'rehydration', durationMs: 30 },
      ],
    });
  });

  it('adopts the document-level start mark instead of resetting the clock', () => {
    resetBootTimingsForTesting();
    const startEntry = { startTime: 12 } as PerformanceEntry;
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([startEntry]);
    vi.spyOn(performance, 'now').mockReturnValue(42);
    const mark = vi.spyOn(performance, 'mark');

    startBootTiming();
    markBootPhase('system-language');
    markBootPhase('i18n');
    markBootPhase('react-mount');
    markBootPhase('first-paint');
    markBootPhase('rehydration');

    expect(getBootTimings()).toEqual({
      version: 1,
      totalDurationMs: 30,
      phases: [
        { phase: 'system-language', durationMs: 30 },
        { phase: 'i18n', durationMs: 0 },
        { phase: 'react-mount', durationMs: 0 },
        { phase: 'first-paint', durationMs: 0 },
        { phase: 'rehydration', durationMs: 0 },
      ],
    });
    expect(mark).not.toHaveBeenCalledWith('lingua:boot:start');
  });

  it('copies JSON with durations but no timestamps, paths, or user data', async () => {
    const writer = vi.fn().mockResolvedValue(undefined);
    resetBootTimingsForTesting();
    startBootTiming();
    markBootPhase('system-language');

    await expect(copyBootTimingsToClipboard(writer)).resolves.toBe(true);
    const payload = JSON.parse(writer.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(payload).toHaveProperty('version', 1);
    expect(payload).toHaveProperty('phases');
    expect(JSON.stringify(payload)).not.toMatch(/timestamp|path|locale|languageValue|user/iu);
  });

  it('returns false when the clipboard writer is unavailable', async () => {
    await expect(copyBootTimingsToClipboard(undefined)).resolves.toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatRunAge, utcDateLabel } from '../../src/renderer/utils/timeLabels';

const NOW = Date.UTC(2026, 9, 17, 1, 0, 0);
const HOUR = 3_600_000;

describe('time labels', () => {
  it('formats an ISO instant as a UTC date', () => {
    expect(utcDateLabel('2026-10-17T00:00:00.000Z')).toBe('2026-10-17 00:00:00 UTC');
    expect(utcDateLabel('2026-10-17T00:00:00Z')).toBe('2026-10-17 00:00:00 UTC');
  });

  it('keeps hours up to two days and switches to days after', () => {
    expect(formatRelativeTime(NOW + 23 * HOUR, NOW, 'en')).toBe('in 23 hr.');
    expect(formatRelativeTime(NOW + 47 * HOUR, NOW, 'en')).toBe('in 47 hr.');
    expect(formatRelativeTime(NOW + 72 * HOUR, NOW, 'en')).toBe('in 3 days');
    expect(formatRelativeTime(NOW - HOUR, NOW, 'en')).toBe('1 hr. ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW, 'en')).toBe('5 min. ago');
  });

  it('dates a run in seconds, minutes or hours and never says zero seconds', () => {
    const t = (key: string, values?: Record<string, number>) => `${key.split('.').pop()}:${values?.count}`;
    expect(formatRunAge(NOW, NOW, t)).toBe('seconds:1');
    expect(formatRunAge(NOW - 59_000, NOW, t)).toBe('seconds:59');
    expect(formatRunAge(NOW - 90_000, NOW, t)).toBe('minutes:2');
    expect(formatRunAge(NOW - 3 * HOUR, NOW, t)).toBe('hours:3');
  });

  it('localizes the phrase', () => {
    expect(formatRelativeTime(NOW + 23 * HOUR, NOW, 'es')).toBe('dentro de 23 h');
  });
});

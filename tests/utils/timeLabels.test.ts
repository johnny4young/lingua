import { describe, expect, it } from 'vitest';
import { relativeTimeLabel, utcDateLabel } from '../../src/renderer/utils/timeLabels';

const NOW = Date.UTC(2026, 9, 17, 1, 0, 0);
const HOUR = 3_600_000;

describe('time labels', () => {
  it('formats an ISO instant as a UTC date', () => {
    expect(utcDateLabel('2026-10-17T00:00:00.000Z')).toBe('2026-10-17 00:00:00 UTC');
    expect(utcDateLabel('2026-10-17T00:00:00Z')).toBe('2026-10-17 00:00:00 UTC');
  });

  it('keeps hours up to two days and switches to days after', () => {
    expect(relativeTimeLabel(NOW + 23 * HOUR, NOW, 'en')).toBe('in 23 hr.');
    expect(relativeTimeLabel(NOW + 47 * HOUR, NOW, 'en')).toBe('in 47 hr.');
    expect(relativeTimeLabel(NOW + 72 * HOUR, NOW, 'en')).toBe('in 3 days');
    expect(relativeTimeLabel(NOW - HOUR, NOW, 'en')).toBe('1 hr. ago');
    expect(relativeTimeLabel(NOW - 5 * 60_000, NOW, 'en')).toBe('5 min. ago');
  });

  it('localizes the phrase', () => {
    expect(relativeTimeLabel(NOW + 23 * HOUR, NOW, 'es')).toBe('dentro de 23 h');
  });
});

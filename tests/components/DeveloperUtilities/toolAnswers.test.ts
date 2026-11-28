import { describe, expect, it } from 'vitest';
import {
  claimTime,
  countAnswer,
  countChars,
  hasTimeClaim,
  invalidAnswer,
  isOneOf,
  jwtAnswer,
  segmentBytes,
} from '../../../src/renderer/components/DeveloperUtilities/toolAnswers';

const NOW = Date.UTC(2026, 10, 11, 13, 2, 0);
const MINUTE = 60_000;
const t = (key: string, options?: Record<string, unknown>) =>
  options && 'count' in options ? `${key.split('.').pop()}:${String(options.count)}` : key.split('.').pop() ?? key;
const seconds = (ms: number) => ms / 1000;
const HS256 = { alg: 'HS256', typ: 'JWT' };

describe('tool answers', () => {
  it('answers a JWT with the time left, scaling the unit as the expiry moves away', () => {
    expect(jwtAnswer(HS256, { exp: seconds(NOW + 58 * MINUTE + 20_000) }, NOW, t, 'en')).toEqual({
      answer: { value: '58', unit: 'minutesLeft:58' },
      meta: 'HS256 · 1 claims:1',
    });
    expect(jwtAnswer(HS256, { exp: seconds(NOW + 5 * 60 * MINUTE) }, NOW, t, 'en').answer).toEqual({ value: '5', unit: 'hoursLeft:5' });
    expect(jwtAnswer(HS256, { exp: seconds(NOW + 3 * 24 * 60 * MINUTE) }, NOW, t, 'en').answer).toEqual({ value: '3', unit: 'daysLeft:3' });
  });

  it('answers an expired JWT with how long ago, and one that never expires with its claim count', () => {
    expect(jwtAnswer(HS256, { exp: seconds(NOW - 2 * 60 * MINUTE) }, NOW, t, 'en').answer).toEqual({
      value: 'expired',
      word: true,
      unit: '2 hr. ago',
    });
    expect(jwtAnswer(HS256, { exp: seconds(NOW) }, NOW, t, 'en').answer.value).toBe('expired');
    // The count is already the numeral, so the meta names only the algorithm.
    expect(jwtAnswer(HS256, { sub: 'a', role: 'b', iat: 1 }, NOW, t, 'en')).toEqual({
      answer: { value: '3', unit: 'claims:3' },
      meta: 'HS256',
    });
    expect(jwtAnswer({}, { exp: 1e308 }, NOW, t, 'en')).toEqual({ answer: { value: '1', unit: 'claims:1' }, meta: '' });
  });

  it('reads only finite numbers inside the Date range as claim times', () => {
    expect(claimTime(1794405600)).toBe(1794405600000);
    expect(claimTime('1794405600')).toBeNull();
    expect(claimTime(Number.NaN)).toBeNull();
    expect(claimTime(1e308)).toBeNull();
    expect(hasTimeClaim({ sub: 'a', nbf: 1794405600 })).toBe(true);
    expect(hasTimeClaim({ sub: 'a', exp: 'soon' })).toBe(false);
    expect(hasTimeClaim(null)).toBe(false);
  });

  it('sizes a base64url segment by the bytes it decodes to', () => {
    expect(segmentBytes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(27);
    expect(segmentBytes('A4XuGi83qhbZVaQ8kSERx4KIA7-BskQiefEd2RdAc3A')).toBe(32);
    expect(segmentBytes('TGluZ3Vh')).toBe(6);
    expect(segmentBytes('TGluZ3VhIQ==')).toBe(7);
    expect(segmentBytes('')).toBe(0);
  });

  it('counts code points, grouping the number for the locale', () => {
    expect(countChars('héllo 👋')).toBe(7);
    expect(countChars('\uD83D')).toBe(1);
    expect(countChars('')).toBe(0);
    expect(countAnswer(12_345, 'utilities.answer.hash.bytes', t, 'en')).toEqual({ value: '12,345', unit: 'bytes:12345' });
    expect(countAnswer(12_345, 'utilities.answer.hash.bytes', t, 'es').value).toBe('12.345');
    expect(invalidAnswer(t)).toEqual({ value: 'invalid', word: true, tone: 'error' });
  });

  it('narrows a tab id to a tool mode', () => {
    const modes = ['encode', 'decode'] as const;
    expect(isOneOf(modes, 'decode')).toBe(true);
    expect(isOneOf(modes, 'sign')).toBe(false);
  });
});

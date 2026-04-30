/**
 * Unit tests for the KV-backed rate limiter (RL-061 Slice 4).
 *
 * The limiter ships under `src/lib/rateLimit.ts` and is consumed by
 * `/trials/start`, `/education/start`, and `/licenses/recover/start`.
 * Tests pin: KV key shape, daily reset boundary semantics, prior +
 * current counter math, retryAfter math, and the read-only peek
 * variant that does NOT increment.
 */

import { describe, expect, it } from 'vitest';
import { consumeRateLimit, dayUtc, peekRateLimit, rateLimitKey } from '../../src/lib/rateLimit';
import { createMockKV } from '../helpers';

describe('rateLimitKey', () => {
  it('joins scope, key part, and UTC day with the canonical separator', () => {
    expect(rateLimitKey('trials', '1.2.3.4', '2026-04-29')).toBe('trials:rl:1.2.3.4:2026-04-29');
  });
});

describe('dayUtc', () => {
  it('formats epoch seconds as a stable yyyy-mm-dd UTC string', () => {
    // 2026-04-29T08:00:00Z → 1745913600
    expect(dayUtc(1745913600)).toBe('2025-04-29');
  });

  it('handles month rollovers', () => {
    // 2026-12-31T23:59:59Z then 2027-01-01T00:00:00Z
    const lastDayOfYear = Math.floor(Date.UTC(2026, 11, 31, 23, 59, 59) / 1000);
    const firstDayOfYear = Math.floor(Date.UTC(2027, 0, 1, 0, 0, 0) / 1000);
    expect(dayUtc(lastDayOfYear)).toBe('2026-12-31');
    expect(dayUtc(firstDayOfYear)).toBe('2027-01-01');
  });
});

describe('consumeRateLimit', () => {
  it('allows the first hit with prior=0 and persists count=1 in KV', async () => {
    const kv = createMockKV();
    const now = () => 1_700_000_000;
    const result = await consumeRateLimit(kv, {
      scope: 'trials',
      keyPart: '1.2.3.4',
      limit: 3,
      now,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.prior).toBe(0);
      expect(result.current).toBe(1);
    }
    const stored = await kv.get(rateLimitKey('trials', '1.2.3.4', dayUtc(1_700_000_000)));
    expect(stored).toBe('1');
  });

  it('tracks count across consecutive hits and denies once the limit is reached', async () => {
    const kv = createMockKV();
    const now = () => 1_700_000_000;

    const first = await consumeRateLimit(kv, { scope: 'trials', keyPart: 'ip', limit: 3, now });
    const second = await consumeRateLimit(kv, { scope: 'trials', keyPart: 'ip', limit: 3, now });
    const third = await consumeRateLimit(kv, { scope: 'trials', keyPart: 'ip', limit: 3, now });
    const fourth = await consumeRateLimit(kv, { scope: 'trials', keyPart: 'ip', limit: 3, now });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) {
      expect(fourth.current).toBe(3);
      expect(fourth.retryAfter).toBeGreaterThan(0);
    }
  });

  it('uses a separate bucket per scope so trials and education do not bleed across', async () => {
    const kv = createMockKV();
    const now = () => 1_700_000_000;

    // Burn the trials limit.
    await consumeRateLimit(kv, { scope: 'trials', keyPart: 'shared-ip', limit: 1, now });
    const trialsDenied = await consumeRateLimit(kv, {
      scope: 'trials',
      keyPart: 'shared-ip',
      limit: 1,
      now,
    });
    expect(trialsDenied.allowed).toBe(false);

    // Education from the same IP still allowed.
    const educationAllowed = await consumeRateLimit(kv, {
      scope: 'education',
      keyPart: 'shared-ip',
      limit: 1,
      now,
    });
    expect(educationAllowed.allowed).toBe(true);
  });

  it('treats a corrupted counter (NaN) as 0 so a key collision with junk does not lock out users', async () => {
    const kv = createMockKV();
    await kv.put('trials:rl:ip:2025-04-29', 'definitely-not-a-number');

    const result = await consumeRateLimit(kv, {
      scope: 'trials',
      keyPart: 'ip',
      limit: 3,
      now: () => 1_745_913_600,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.prior).toBe(0);
      expect(result.current).toBe(1);
    }
  });
});

describe('peekRateLimit', () => {
  it('returns the current count without incrementing', async () => {
    const kv = createMockKV();
    const now = () => 1_700_000_000;
    await consumeRateLimit(kv, { scope: 'trials', keyPart: 'ip', limit: 5, now });
    await consumeRateLimit(kv, { scope: 'trials', keyPart: 'ip', limit: 5, now });

    const peek = await peekRateLimit(kv, { scope: 'trials', keyPart: 'ip', now });
    expect(peek.count).toBe(2);

    const peekAgain = await peekRateLimit(kv, { scope: 'trials', keyPart: 'ip', now });
    expect(peekAgain.count).toBe(2); // unchanged
  });

  it('returns 0 for a fresh key', async () => {
    const kv = createMockKV();
    const peek = await peekRateLimit(kv, {
      scope: 'trials',
      keyPart: 'never-seen',
      now: () => 1_700_000_000,
    });
    expect(peek.count).toBe(0);
  });
});

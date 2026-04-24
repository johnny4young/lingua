import { afterEach, describe, expect, it } from 'vitest';
import {
  RANDOM_STRING_AMBIGUOUS,
  RANDOM_STRING_DIGITS,
  RANDOM_STRING_LOWERCASE,
  RANDOM_STRING_SYMBOLS,
  RANDOM_STRING_UPPERCASE,
  buildCharset,
  generateRandomStrings,
} from '@/utils/randomString';

describe('buildCharset', () => {
  it('returns an empty charset when every toggle is off', () => {
    const pool = buildCharset({
      lowercase: false,
      uppercase: false,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
    });
    expect(pool).toBe('');
  });

  it('returns only digits when the Digits toggle is the single one on', () => {
    const pool = buildCharset({
      lowercase: false,
      uppercase: false,
      digits: true,
      symbols: false,
      excludeAmbiguous: false,
    });
    expect(pool).toBe(RANDOM_STRING_DIGITS);
  });

  it('concatenates lowercase + uppercase + digits with no duplicates', () => {
    const pool = buildCharset({
      lowercase: true,
      uppercase: true,
      digits: true,
      symbols: false,
      excludeAmbiguous: false,
    });
    expect(pool.length).toBe(
      RANDOM_STRING_LOWERCASE.length + RANDOM_STRING_UPPERCASE.length + RANDOM_STRING_DIGITS.length,
    );
    // No duplicate chars across classes.
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('strips ambiguous chars when the Exclude Ambiguous toggle is on', () => {
    const pool = buildCharset({
      lowercase: true,
      uppercase: true,
      digits: true,
      symbols: false,
      excludeAmbiguous: true,
    });
    for (const char of RANDOM_STRING_AMBIGUOUS) {
      expect(pool).not.toContain(char);
    }
    // Non-ambiguous letters survive.
    expect(pool).toContain('a');
    expect(pool).toContain('A');
    expect(pool).toContain('2');
  });

  it('keeps the Symbols pool intact when Exclude Ambiguous is on (| is the only overlap)', () => {
    const pool = buildCharset({
      lowercase: false,
      uppercase: false,
      digits: false,
      symbols: true,
      excludeAmbiguous: true,
    });
    // `|` is the one symbol in the ambiguous set — it must be gone.
    expect(pool).not.toContain('|');
    // Every other symbol char survives.
    for (const char of RANDOM_STRING_SYMBOLS) {
      if (char === '|') continue;
      expect(pool).toContain(char);
    }
  });
});

describe('generateRandomStrings', () => {
  const originalGetRandomValues = crypto.getRandomValues.bind(crypto);

  afterEach(() => {
    // Restore the native impl after any mock so later tests run unbiased.
    (crypto as { getRandomValues: typeof crypto.getRandomValues }).getRandomValues =
      originalGetRandomValues;
  });

  it('returns empty-charset when the charset is empty', () => {
    const result = generateRandomStrings(8, 3, '');
    expect(result).toEqual({ ok: false, kind: 'empty-charset' });
  });

  it('returns an empty values array when length or count is 0', () => {
    expect(generateRandomStrings(0, 3, 'abc')).toEqual({ ok: true, values: [] });
    expect(generateRandomStrings(3, 0, 'abc')).toEqual({ ok: true, values: [] });
  });

  it('produces count rows of length chars drawn only from the charset', () => {
    const charset = 'abcdef0123';
    const result = generateRandomStrings(16, 4, charset);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toHaveLength(4);
    for (const value of result.values) {
      expect(value).toHaveLength(16);
      for (const char of value) {
        expect(charset).toContain(char);
      }
    }
  });

  it('clamps length to 1024 and count to 100 defensively', () => {
    const result = generateRandomStrings(9999, 9999, 'ab');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toHaveLength(100);
    for (const value of result.values) {
      expect(value).toHaveLength(1024);
    }
  });

  it('rejects modulo-biased draws (pins the rejection sampling threshold)', () => {
    // For charset size 3, the unbiased threshold is
    // floor(0xFFFFFFFF / 3) * 3 = 0xFFFFFFFF. Only the single value
    // 0xFFFFFFFF gets rejected (residue 0 otherwise outnumbers residues
    // 1 and 2 by exactly one — rejection sampling removes the extra).
    //
    // Feed: accept 0xFFFFFFFE (mod 3 = 2 → 'c'), reject 0xFFFFFFFF
    // (threshold), accept 0 → 'a', accept 1 → 'b', accept 2 → 'c'.
    // Four accepted draws produce 'cabc' for length 4.
    const charset = 'abc';
    const feed = [0xfffffffe, 0xffffffff, 0, 1, 2];
    let index = 0;
    (crypto as { getRandomValues: typeof crypto.getRandomValues }).getRandomValues = ((
      buffer: ArrayBufferView,
    ) => {
      const view = buffer as Uint32Array;
      for (let i = 0; i < view.length; i += 1) {
        view[i] = feed[index++] ?? 0;
      }
      return buffer;
    }) as typeof crypto.getRandomValues;

    const result = generateRandomStrings(4, 1, charset);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values[0]).toBe('cabc');
  });

  it('produces different values across invocations with the native RNG (probabilistic)', () => {
    const charset = RANDOM_STRING_LOWERCASE + RANDOM_STRING_UPPERCASE + RANDOM_STRING_DIGITS;
    const first = generateRandomStrings(32, 1, charset);
    const second = generateRandomStrings(32, 1, charset);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Collision on 32 chars across a 62-char alphabet is astronomically
    // unlikely — a failure here is a real signal that the RNG is stuck.
    expect(first.values[0]).not.toBe(second.values[0]);
  });
});

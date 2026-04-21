import { describe, expect, it } from 'vitest';
import {
  MAX_BASE,
  MIN_BASE,
  formatInBase,
  isValidBase,
  parseInAnyBase,
} from '@/utils/numberBase';

describe('isValidBase', () => {
  it('accepts every integer in [MIN_BASE, MAX_BASE]', () => {
    for (let base = MIN_BASE; base <= MAX_BASE; base += 1) {
      expect(isValidBase(base)).toBe(true);
    }
  });

  it('rejects values outside the accepted range', () => {
    expect(isValidBase(1)).toBe(false);
    expect(isValidBase(37)).toBe(false);
    expect(isValidBase(0)).toBe(false);
    expect(isValidBase(-2)).toBe(false);
  });

  it('rejects non-integers and NaN', () => {
    expect(isValidBase(2.5)).toBe(false);
    expect(isValidBase(Number.NaN)).toBe(false);
    expect(isValidBase(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('parseInAnyBase / formatInBase', () => {
  it('round-trips simple values across all common bases', () => {
    const fixtures: Array<[string, number, bigint]> = [
      ['11111111', 2, 255n],
      ['377', 8, 255n],
      ['255', 10, 255n],
      ['FF', 16, 255n],
      ['ff', 16, 255n],
    ];
    for (const [input, base, expected] of fixtures) {
      expect(parseInAnyBase(input, base)).toBe(expected);
      expect(formatInBase(expected, base)).toBe(input.toUpperCase());
    }
  });

  it('handles negative values and explicit +', () => {
    expect(parseInAnyBase('-FF', 16)).toBe(-255n);
    expect(parseInAnyBase('+10', 10)).toBe(10n);
    expect(formatInBase(-255n, 16)).toBe('-FF');
  });

  it('auto-detects 0x / 0o / 0b prefixes when the base is 10', () => {
    expect(parseInAnyBase('0xff', 10)).toBe(255n);
    expect(parseInAnyBase('0o377', 10)).toBe(255n);
    expect(parseInAnyBase('0b11111111', 10)).toBe(255n);
  });

  it('does not auto-detect prefixes when the base is non-decimal', () => {
    // `0xff` in base 16 is just the digits 0, X (invalid) → null.
    expect(parseInAnyBase('0xff', 16)).toBeNull();
    // `0b1` in base 2 contains `b` which is not a base-2 digit.
    expect(parseInAnyBase('0b1', 2)).toBeNull();
  });

  it('allows underscores as digit separators', () => {
    expect(parseInAnyBase('1_000_000', 10)).toBe(1_000_000n);
    expect(parseInAnyBase('FF_FF', 16)).toBe(0xffffn);
    // Leading/trailing underscores are fine as long as something remains.
    expect(parseInAnyBase('_1_0_', 10)).toBe(10n);
  });

  it('rejects empty and whitespace-only inputs', () => {
    expect(parseInAnyBase('', 10)).toBeNull();
    expect(parseInAnyBase('   ', 10)).toBeNull();
  });

  it('rejects an input that is only a sign', () => {
    expect(parseInAnyBase('-', 10)).toBeNull();
    expect(parseInAnyBase('+', 16)).toBeNull();
  });

  it('rejects digits outside the chosen base', () => {
    expect(parseInAnyBase('2', 2)).toBeNull();
    expect(parseInAnyBase('8', 8)).toBeNull();
    expect(parseInAnyBase('G', 16)).toBeNull();
  });

  it('handles custom bases 2..36', () => {
    // base 7: "123" = 1*49 + 2*7 + 3 = 66
    expect(parseInAnyBase('123', 7)).toBe(66n);
    expect(formatInBase(66n, 7)).toBe('123');
    // base 36: "ZZ" = 35*36 + 35 = 1295
    expect(parseInAnyBase('ZZ', 36)).toBe(1295n);
    expect(formatInBase(1295n, 36)).toBe('ZZ');
  });

  it('rejects bases outside [2, 36] cleanly', () => {
    expect(parseInAnyBase('1', 1)).toBeNull();
    expect(parseInAnyBase('1', 37)).toBeNull();
    expect(formatInBase(10n, 1)).toBe('');
    expect(formatInBase(10n, 37)).toBe('');
  });

  it('round-trips very large integers losslessly (beyond Number precision)', () => {
    // 2^100 exceeds Number.MAX_SAFE_INTEGER by ~77 orders of magnitude.
    const big = 1n << 100n;
    const hex = formatInBase(big, 16);
    expect(parseInAnyBase(hex, 16)).toBe(big);
  });

  it('format output uppercases letters for readability', () => {
    expect(formatInBase(255n, 16)).toBe('FF');
    expect(formatInBase(30n, 16)).toBe('1E');
  });
});

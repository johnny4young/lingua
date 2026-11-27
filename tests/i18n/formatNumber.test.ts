import { describe, expect, it } from 'vitest';
import { formatByteSize, formatNumber } from '../../src/renderer/i18n/formatNumber';

describe('formatNumber', () => {
  it('uses Lingua English and Spanish grouping instead of the host locale', () => {
    expect(formatNumber(100_000, 'en')).toBe('100,000');
    expect(formatNumber(100_000, 'es')).toBe('100.000');
  });

  it('handles signed, decimal, and bigint values', () => {
    expect(formatNumber(-12_345.5, 'en')).toBe('-12,345.5');
    expect(formatNumber(-12_345.5, 'es')).toBe('-12.345,5');
    expect(formatNumber(9_007_199_254_740_993n, 'en')).toBe('9,007,199,254,740,993');
  });

  it('falls back to English for unsupported application languages', () => {
    expect(formatNumber(10_000, 'fr')).toBe('10,000');
  });
});

describe('formatByteSize', () => {
  it('writes unit symbols, never the long byte word', () => {
    expect(formatByteSize(917, 'en')).toBe('917 B');
    expect(formatByteSize(3174, 'en')).toBe('3.1 kB');
    expect(formatByteSize(214 * 1024 * 1024, 'en')).toBe('214 MB');
  });

  it('groups and marks decimals in the app language', () => {
    expect(formatByteSize(3174, 'es')).toBe('3,1 kB');
    expect(formatByteSize(1000, 'es')).toBe('1000 B');
    expect(formatByteSize(-5, 'en')).toBe('0 B');
  });
});

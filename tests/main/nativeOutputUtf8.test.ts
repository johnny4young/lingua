import { describe, expect, it } from 'vitest';
import { truncateNativeOutputUtf8 } from '../../src/main/runners/nativeOutputUtf8';

describe('truncateNativeOutputUtf8', () => {
  it.each([
    { value: 'short', cap: 100 },
    { value: 'abcde', cap: 5 },
    { value: '漢字', cap: 6 },
    { value: '😀😀', cap: 8 },
  ])('keeps fitting text unchanged: $value / $cap bytes', ({ value, cap }) => {
    expect(truncateNativeOutputUtf8(value, cap, '[cut]')).toBe(value);
  });

  it.each([
    { name: 'fractional CJK boundary', value: '漢漢', cap: 2.5, marker: '', expected: '' },
    {
      name: 'fractional marker boundary',
      value: 'abcdefgh',
      cap: 3.5,
      marker: '😀!',
      expected: 'abc',
    },
    {
      name: 'ASCII with marker headroom',
      value: 'x'.repeat(40),
      cap: 12,
      marker: '[cut]',
      expected: 'xxxxxxx[cut]',
    },
    {
      name: 'CJK source boundary',
      value: '漢'.repeat(10),
      cap: 12,
      marker: '[cut]',
      expected: '漢漢[cut]',
    },
    {
      name: 'surrogate-pair source boundary',
      value: '😀'.repeat(10),
      cap: 12,
      marker: '[cut]',
      expected: '😀[cut]',
    },
    {
      name: 'UTF-8 marker reservation',
      value: 'abcdefghijk',
      cap: 10,
      marker: 'é漢',
      expected: 'abcdeé漢',
    },
    {
      name: 'leading source BOM',
      value: '\uFEFFabcdefgh',
      cap: 7,
      marker: '!',
      expected: '\uFEFFabc!',
    },
    {
      name: 'leading marker BOM',
      value: 'abcdefgh',
      cap: 7,
      marker: '\uFEFF!',
      expected: 'abc\uFEFF!',
    },
    { name: 'marker fills budget', value: 'abcdefgh', cap: 5, marker: '[cut]', expected: '[cut]' },
    {
      name: 'ASCII marker exceeds budget',
      value: 'abcdefgh',
      cap: 3,
      marker: '[cut]',
      expected: '[cu',
    },
    {
      name: 'marker surrogate pair does not fit',
      value: 'abcdefgh',
      cap: 3,
      marker: '😀!',
      expected: 'abc',
    },
    {
      name: 'marker clipped on CJK boundary',
      value: 'abcdefgh',
      cap: 6,
      marker: '漢😀',
      expected: 'abc漢',
    },
    {
      name: 'marker clipped on surrogate-pair boundary',
      value: 'abcdefgh',
      cap: 5,
      marker: '😀漢',
      expected: 'a😀',
    },
    { name: 'zero budget', value: 'abc', cap: 0, marker: '[cut]', expected: '' },
    { name: 'empty marker', value: '漢漢漢', cap: 5, marker: '', expected: '漢' },
  ])('enforces the complete byte budget: $name', ({ value, cap, marker, expected }) => {
    const actual = truncateNativeOutputUtf8(value, cap, marker);
    expect(actual).toBe(expected);
    expect(Buffer.byteLength(actual, 'utf8')).toBeLessThanOrEqual(cap);
    const loneSurrogate = Array.from(actual).some(character => {
      const code = character.charCodeAt(0);
      return character.length === 1 && code >= 0xd800 && code <= 0xdfff;
    });
    expect(loneSurrogate).toBe(false);
  });

  it('clamps a negative cap to zero bytes', () => {
    expect(truncateNativeOutputUtf8('abc', -1, '[cut]')).toBe('');
  });
});

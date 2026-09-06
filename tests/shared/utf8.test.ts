import { describe, expect, it } from 'vitest';

import { truncateUtf8, utf8ByteLength } from '../../src/shared/utf8';

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('utf8ByteLength', () => {
  it('counts bytes, not code units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('日本')).toBe(6);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('truncateUtf8', () => {
  it('returns the input unchanged when it fits', () => {
    expect(truncateUtf8('hello', 5)).toBe('hello');
    expect(truncateUtf8('日本', 6)).toBe('日本');
  });

  it('returns an empty string for a non-positive budget', () => {
    expect(truncateUtf8('hello', 0)).toBe('');
    expect(truncateUtf8('hello', -1)).toBe('');
  });

  it('cuts ASCII exactly at the byte budget', () => {
    expect(truncateUtf8('abcdef', 4)).toBe('abcd');
  });

  it('preserves a leading BOM as payload data when truncating', () => {
    expect(truncateUtf8('\uFEFFabcd', 5)).toBe('\uFEFFab');
    expect(truncateUtf8('\uFEFFabcd', 3)).toBe('\uFEFF');
    expect(truncateUtf8('\uFEFFabcd', 2)).toBe('');
  });

  it('never splits a multibyte character', () => {
    // 日 = 3 bytes; a 4-byte budget keeps one character, not one byte of the next
    expect(truncateUtf8('日本語', 4)).toBe('日');
    expect(truncateUtf8('日本語', 5)).toBe('日');
    expect(truncateUtf8('日本語', 6)).toBe('日本');
    // é = 2 bytes after a 1-byte a
    expect(truncateUtf8('aé', 2)).toBe('a');
  });

  it('never emits a lone surrogate for astral characters', () => {
    const emoji = '😀'.repeat(50);
    for (const budget of [1, 2, 3, 4, 5, 7, 9, 13, 199]) {
      const cut = truncateUtf8(emoji, budget);
      expect(hasLoneSurrogate(cut)).toBe(false);
      expect(utf8ByteLength(cut)).toBeLessThanOrEqual(budget);
      expect(cut.length % 2).toBe(0);
    }
  });

  it('keeps the longest prefix that fits for mixed content', () => {
    const value = 'ab日😀c';
    // a(1) b(1) 日(3) 😀(4) c(1) = 10 bytes
    expect(truncateUtf8(value, 9)).toBe('ab日😀');
    expect(truncateUtf8(value, 8)).toBe('ab日');
    expect(truncateUtf8(value, 4)).toBe('ab');
  });
});

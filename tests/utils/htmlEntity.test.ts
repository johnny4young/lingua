import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, encodeHtmlEntities } from '@/utils/htmlEntity';

describe('encodeHtmlEntities — minimal strategy', () => {
  it('escapes only the five structural characters', () => {
    const input = `<div class="a">© & ñ</div>`;
    expect(encodeHtmlEntities(input, 'minimal')).toBe(
      '&lt;div class=&quot;a&quot;&gt;© &amp; ñ&lt;/div&gt;',
    );
  });

  it('is a no-op for ASCII text without special chars', () => {
    const input = 'hello world 123';
    expect(encodeHtmlEntities(input, 'minimal')).toBe(input);
  });

  it('returns an empty string for empty input', () => {
    expect(encodeHtmlEntities('', 'minimal')).toBe('');
  });
});

describe('encodeHtmlEntities — named strategy', () => {
  it('uses named entities where available and escapes structural chars', () => {
    const input = `<p>© 2024 ñ</p>`;
    expect(encodeHtmlEntities(input, 'named')).toBe(
      '&lt;p&gt;&copy; 2024 &ntilde;&lt;/p&gt;',
    );
  });

  it('falls back to decimal numeric for codepoints outside the named table', () => {
    // U+2605 ★ is not in the curated named table → numeric fallback.
    expect(encodeHtmlEntities('★', 'named')).toBe('&#9733;');
  });

  it('leaves ASCII printable text alone', () => {
    expect(encodeHtmlEntities('plain text', 'named')).toBe('plain text');
  });
});

describe('encodeHtmlEntities — numeric strategy', () => {
  it('escapes every non-ASCII codepoint as decimal numeric', () => {
    expect(encodeHtmlEntities('ñ€', 'numeric')).toBe('&#241;&#8364;');
  });

  it('encodes astral codepoints (emoji) as a single numeric reference', () => {
    // 🎉 is U+1F389.
    expect(encodeHtmlEntities('🎉', 'numeric')).toBe('&#127881;');
  });

  it('preserves ASCII chars even when mixed with non-ASCII', () => {
    expect(encodeHtmlEntities('abc ñ', 'numeric')).toBe('abc &#241;');
  });
});

describe('decodeHtmlEntities', () => {
  it('resolves named, decimal, and hex references in a single pass', () => {
    const result = decodeHtmlEntities('&lt;p&gt;&copy; 2024 &#241;&#x2014;</p>');
    expect(result.text).toBe('<p>© 2024 ñ—</p>');
    expect(result.unresolvedCount).toBe(0);
  });

  it('leaves unknown references intact and counts them', () => {
    const result = decodeHtmlEntities('&foo; &bar; &amp;');
    expect(result.text).toBe('&foo; &bar; &');
    expect(result.unresolvedCount).toBe(2);
  });

  it('is the inverse of encode("named") for Latin-1 + structural text', () => {
    const samples = [
      '<p>café</p>',
      '“quoted” words — em dash',
      '© 2024 Lingua & Friends',
      'ÀÁÂÃÄÅÆÇÈÉÊË',
    ];
    for (const sample of samples) {
      const round = decodeHtmlEntities(encodeHtmlEntities(sample, 'named')).text;
      expect(round).toBe(sample);
    }
  });

  it('round-trips through numeric encoding without loss (including emoji)', () => {
    const sample = 'hello 🎉 — ★ ñ';
    const round = decodeHtmlEntities(encodeHtmlEntities(sample, 'numeric')).text;
    expect(round).toBe(sample);
  });

  it('rejects out-of-range numeric references without throwing', () => {
    // 0x110000 is 1 past the Unicode max.
    const result = decodeHtmlEntities('&#x110000;');
    expect(result.unresolvedCount).toBe(1);
    expect(result.text).toBe('&#x110000;');
  });

  it('returns zero unresolved on plain text with no references', () => {
    const result = decodeHtmlEntities('just plain text');
    expect(result).toEqual({ text: 'just plain text', unresolvedCount: 0 });
  });

  it('handles a 200 KB payload without catastrophic regex backtracking', () => {
    const chunk = 'the quick brown fox jumps over the lazy dog ';
    const input = `&amp; ${chunk.repeat(5000)} &unknown;`;
    const start = Date.now();
    const result = decodeHtmlEntities(input);
    const elapsed = Date.now() - start;
    expect(result.unresolvedCount).toBe(1);
    expect(elapsed).toBeLessThan(250); // soft budget — regex must not backtrack.
  });
});

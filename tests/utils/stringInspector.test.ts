import { describe, expect, it } from 'vitest';
import { INSPECT_MAX_CHARS, inspect } from '@/utils/stringInspector';

describe('inspect — counts', () => {
  it('returns zero counts and no warnings for empty input', () => {
    const report = inspect('');
    expect(report.characters).toEqual([]);
    expect(report.counts).toEqual({
      charactersUtf16: 0,
      graphemesApprox: 0,
      bytesUtf8: 0,
      bytesUtf16: 0,
    });
    expect(report.warnings).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it('counts UTF-16 units, graphemes, and both UTF-8 / UTF-16 byte lengths for ASCII', () => {
    const report = inspect('abc');
    expect(report.counts).toEqual({
      charactersUtf16: 3,
      graphemesApprox: 3,
      bytesUtf8: 3,
      bytesUtf16: 6,
    });
  });

  it('counts astral codepoints correctly (1 codepoint, 2 UTF-16 units, 4 UTF-8 bytes)', () => {
    // 🎉 is U+1F389 — requires a surrogate pair in UTF-16.
    const report = inspect('🎉');
    expect(report.counts.charactersUtf16).toBe(2);
    expect(report.counts.graphemesApprox).toBe(1);
    expect(report.counts.bytesUtf8).toBe(4);
    expect(report.counts.bytesUtf16).toBe(4);
  });

  it('tracks Latin-1 characters as 2 bytes in UTF-8', () => {
    const report = inspect('ñ');
    expect(report.counts.bytesUtf8).toBe(2);
    expect(report.counts.charactersUtf16).toBe(1);
  });
});

describe('inspect — character rows', () => {
  it('renders one row per codepoint with hex and category metadata', () => {
    const report = inspect('aB');
    expect(report.characters).toHaveLength(2);
    expect(report.characters[0]).toMatchObject({
      codePoint: 0x61,
      hex: 'U+0061',
      glyph: 'a',
      category: 'printable',
    });
    expect(report.characters[1]?.hex).toBe('U+0042');
  });

  it('classifies ASCII controls outside tab / LF / CR as "control"', () => {
    const report = inspect('\u0007'); // BEL
    expect(report.characters[0]?.category).toBe('control');
    expect(report.characters[0]?.glyph).toBe('·');
  });

  it('classifies tab, LF and CR as whitespace, not control', () => {
    const report = inspect('\t\n\r');
    expect(report.characters.map((c) => c.category)).toEqual([
      'whitespace',
      'whitespace',
      'whitespace',
    ]);
  });
});

describe('inspect — invisible / BiDi warnings', () => {
  it('flags a zero-width space as an invisible character with the right offset', () => {
    const report = inspect('a\u200Bb');
    const zeroWidth = report.warnings.find((w) => w.kind === 'zero-width');
    expect(zeroWidth?.at).toEqual([1]);
    expect(report.characters[1]?.category).toBe('invisible');
    expect(report.characters[1]?.glyph).toBe('·');
  });

  it('flags a right-to-left override (U+202E) as a bidi warning', () => {
    const report = inspect('user\u202Eadmin');
    const bidi = report.warnings.find((w) => w.kind === 'bidi-control');
    expect(bidi?.at).toEqual([4]);
  });

  it('keeps the byte-order mark (U+FEFF) in the zero-width bucket', () => {
    const report = inspect('\uFEFFhello');
    const zeroWidth = report.warnings.find((w) => w.kind === 'zero-width');
    expect(zeroWidth?.at).toEqual([0]);
  });

  it('does not emit a zero-width warning when the input is free of invisibles', () => {
    const report = inspect('hello world');
    expect(report.warnings.find((w) => w.kind === 'zero-width')).toBeUndefined();
    expect(report.warnings.find((w) => w.kind === 'bidi-control')).toBeUndefined();
  });
});

describe('inspect — mixed-script and homoglyph warnings', () => {
  it('flags a word that mixes Latin and Cyrillic letters', () => {
    // "рaypal" — first char is Cyrillic 'er' (U+0440), rest is Latin.
    const report = inspect('\u0440aypal');
    const mixed = report.warnings.find((w) => w.kind === 'mixed-script');
    expect(mixed).toBeTruthy();
    expect(mixed?.at).toEqual([0]);
  });

  it('emits a homoglyph warning at each Cyrillic-look-alike character', () => {
    const report = inspect('pay\u0440al'); // Cyrillic 'er' inside an otherwise-Latin word
    const homoglyph = report.warnings.find((w) => w.kind === 'homoglyph');
    expect(homoglyph?.at).toContain(3);
  });

  it('does not warn on a pure Cyrillic word (no mixing, no Latin look-alike context)', () => {
    const report = inspect('Привет'); // "Hello" in Cyrillic — no warnings expected.
    expect(report.warnings.find((w) => w.kind === 'mixed-script')).toBeUndefined();
    expect(report.warnings.find((w) => w.kind === 'homoglyph')).toBeUndefined();
  });

  it('does not warn on a pure Latin word', () => {
    const report = inspect('paypal');
    expect(report.warnings.find((w) => w.kind === 'mixed-script')).toBeUndefined();
    expect(report.warnings.find((w) => w.kind === 'homoglyph')).toBeUndefined();
  });
});

describe('inspect — truncation', () => {
  it(`truncates rows past INSPECT_MAX_CHARS (${INSPECT_MAX_CHARS}) while keeping counts accurate`, () => {
    const huge = 'a'.repeat(INSPECT_MAX_CHARS + 500);
    const report = inspect(huge);
    expect(report.characters).toHaveLength(INSPECT_MAX_CHARS);
    expect(report.counts.charactersUtf16).toBe(huge.length);
    expect(report.truncated).toBe(true);
    expect(report.totalCharacters).toBe(huge.length);
  });

  it('does not flag truncation when the input fits under the cap', () => {
    const report = inspect('hello');
    expect(report.truncated).toBe(false);
  });
});

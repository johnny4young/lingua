/**
 * RL-070 — Unit tests for `convertSvgToCss`. Covers both encodings, size
 * detection (width/height vs viewBox fallback vs missing), round-trip
 * decodability, percent-encoding safety for CSS string delimiters, and
 * all three error branches (empty, not-SVG, too-large).
 */

import { describe, expect, it } from 'vitest';
import {
  SVG_TO_CSS_MAX_BYTES,
  SVG_TO_CSS_MAX_KB,
  convertSvgToCss,
} from '../../src/renderer/utils/svgToCss';

const TINY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;

describe('convertSvgToCss', () => {
  it('emits a base64 data-URI and CSS block for a minimal SVG', () => {
    const result = convertSvgToCss(TINY_SVG, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.encoding).toBe('base64');
    expect(result.dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(result.cssBlock).toContain('background-image: url("data:image/svg+xml;base64,');
    expect(result.cssBlock).toContain('background-size: 24px 24px;');
    expect(result.cssBlock.trim().endsWith('background-repeat: no-repeat;')).toBe(true);
  });

  it('base64 output decodes back to the exact input', () => {
    const result = convertSvgToCss(TINY_SVG, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.dataUri.replace('data:image/svg+xml;base64,', '');
    // Decode base64 → Latin-1 string → UTF-8 byte-level equivalent → string.
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(TINY_SVG);
  });

  it('percent-encoded output uses the expected substitutions for CSS-unsafe chars', () => {
    const result = convertSvgToCss(TINY_SVG, { encoding: 'percent' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataUri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(result.dataUri.includes('data:image/svg+xml;base64')).toBe(false);
    // `<` and `>` must be percent-escaped.
    expect(result.dataUri).toContain('%3Csvg');
    expect(result.dataUri).toContain('%3E');
    // Must not contain raw double-quote (that would break url("...")).
    expect(result.dataUri.includes('"')).toBe(false);
  });

  it('percent-encodes single quotes so output is safe inside single-quoted CSS strings', () => {
    // Fabricate a minimal SVG that contains a literal single quote in an attribute.
    const svgWithQuote = `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><title>'Quoted'</title></svg>`;
    const result = convertSvgToCss(svgWithQuote, { encoding: 'percent' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataUri.includes("'")).toBe(false);
    expect(result.dataUri).toContain('%27');
  });

  it('percent-encoding escapes `>` inside child element text so output stays CSS-safe', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><title>A > B</title></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'percent' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Every `>` (both tag-closers and the literal in the title) is escaped.
    // encodeURIComponent also escapes space to %20, so the title body
    // "A > B" surfaces as "A%20%3E%20B" — verify that sequence directly
    // so we cover the child-text `>` branch distinct from tag-closer
    // occurrences elsewhere in the URI.
    expect(result.dataUri.includes('>')).toBe(false);
    expect(result.dataUri).toContain('A%20%3E%20B');
  });

  it('extracts width/height even when earlier attribute values contain `>` (regression guard)', () => {
    // Pathological but valid per the spec: a `>` inside a quoted attribute
    // value must not terminate the opening-tag match early.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-weird="<a>b" width="48" height="48" viewBox="0 0 24 24"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 48, height: 48 });
  });

  it('does not confuse data-width or data-height with root dimensions', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-width="99" data-height="99" viewBox="0 0 12 14"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 12, height: 14 });
  });

  it('falls back to viewBox for percentage width/height values', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 20 30"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 20, height: 30 });
  });

  it('ignores non-positive width/height (negative or zero) and falls back to viewBox or no size', () => {
    const negativeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="-10" height="-10" viewBox="0 0 20 20"><path d="M0 0"/></svg>`;
    const negativeResult = convertSvgToCss(negativeSvg, { encoding: 'base64' });
    expect(negativeResult.ok).toBe(true);
    if (!negativeResult.ok) return;
    expect(negativeResult.size).toEqual({ width: 20, height: 20 });

    const zeroSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><path d="M0 0"/></svg>`;
    const zeroResult = convertSvgToCss(zeroSvg, { encoding: 'base64' });
    expect(zeroResult.ok).toBe(true);
    if (!zeroResult.ok) return;
    expect(zeroResult.size).toBeUndefined();
    expect(zeroResult.cssBlock.includes('background-size')).toBe(false);
  });

  it('percent-encoding round-trips non-ASCII content through decodeURIComponent', () => {
    const svgWithEmoji = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>hola ñ 🎉</title></svg>`;
    const result = convertSvgToCss(svgWithEmoji, { encoding: 'percent' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.dataUri.replace('data:image/svg+xml,', '');
    // Restore the `'` tighten before decodeURIComponent.
    const roundTripped = decodeURIComponent(payload.replace(/%27/g, "'"));
    expect(roundTripped).toBe(svgWithEmoji);
  });

  it('prefers width/height over viewBox when both are present', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 48, height: 48 });
    expect(result.cssBlock).toContain('background-size: 48px 48px;');
  });

  it('falls back to viewBox when width/height are missing', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 32"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 16, height: 32 });
    expect(result.cssBlock).toContain('background-size: 16px 32px;');
  });

  it('omits size when neither width/height nor viewBox resolve', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toBeUndefined();
    expect(result.cssBlock.includes('background-size')).toBe(false);
  });

  it('strips unit suffixes so width="24px" still resolves to 24', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 24, height: 24 });
  });

  it('omits size for non-px absolute units instead of guessing px values', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em"><path d="M0 0"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toBeUndefined();
    expect(result.cssBlock.includes('background-size')).toBe(false);
  });

  it('rejects an empty input with the empty error key', () => {
    const result = convertSvgToCss('', { encoding: 'base64' });
    expect(result).toMatchObject({ ok: false, errorKey: 'utilities.tool.svgToCss.error.empty' });
  });

  it('rejects whitespace-only input with the empty error key', () => {
    const result = convertSvgToCss('   \n   ', { encoding: 'base64' });
    expect(result).toMatchObject({ ok: false, errorKey: 'utilities.tool.svgToCss.error.empty' });
  });

  it('rejects input without any <svg token with the notSvg error key', () => {
    const result = convertSvgToCss('this is not an svg document', { encoding: 'base64' });
    expect(result).toMatchObject({ ok: false, errorKey: 'utilities.tool.svgToCss.error.notSvg' });
  });

  it('tolerates an XML prolog above the root svg element', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M0 0h8v8H0z"/></svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toEqual({ width: 8, height: 8 });
  });

  it('rejects a dangling <svg token without a complete opening tag', () => {
    const result = convertSvgToCss('<svg width="10" height="10"', { encoding: 'base64' });
    expect(result).toMatchObject({ ok: false, errorKey: 'utilities.tool.svgToCss.error.notSvg' });
  });

  it('rejects payloads that exceed the byte limit with the tooLarge error key', () => {
    // Pad with a comment body so the resulting UTF-8 byte length overshoots
    // the limit. `<svg>` token still passes the notSvg guard.
    const filler = '/'.repeat(SVG_TO_CSS_MAX_BYTES + 32);
    const svg = `<svg>${filler}</svg>`;
    const result = convertSvgToCss(svg, { encoding: 'base64' });
    expect(result).toMatchObject({ ok: false, errorKey: 'utilities.tool.svgToCss.error.tooLarge' });
  });

  it('exposes the KB cap consistent with the byte cap', () => {
    expect(SVG_TO_CSS_MAX_KB).toBe(Math.round(SVG_TO_CSS_MAX_BYTES / 1024));
    expect(SVG_TO_CSS_MAX_KB).toBe(100);
  });

  it('switching encoding changes the output without mutating the input', () => {
    const base64Result = convertSvgToCss(TINY_SVG, { encoding: 'base64' });
    const percentResult = convertSvgToCss(TINY_SVG, { encoding: 'percent' });
    expect(base64Result.ok).toBe(true);
    expect(percentResult.ok).toBe(true);
    if (!base64Result.ok || !percentResult.ok) return;
    expect(base64Result.dataUri).not.toBe(percentResult.dataUri);
    expect(base64Result.cssBlock).toContain('base64,');
    expect(percentResult.cssBlock.includes(';base64')).toBe(false);
  });
});

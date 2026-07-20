/**
 * internal — SVG → CSS converter helper.
 *
 * Pure, offline, renderer-side. Takes SVG markup and a chosen encoding
 * strategy, returns a tagged-union result carrying a `data:image/svg+xml;…`
 * URI plus a ready-to-paste CSS `background-image` block. When the SVG
 * root element advertises a natural size (via `width`/`height` — preferred
 * — or `viewBox` as a fallback), the CSS block also emits a
 * `background-size: WIDTHpx HEIGHTpx;` line. Missing sizes are silently
 * skipped rather than guessed.
 *
 * Two encoding modes are supported:
 *
 * - `base64` — the SVG is UTF-8 encoded, then emitted as
 *   `data:image/svg+xml;base64,…`. Always safe inside any CSS string
 *   delimiter and the most compatible choice for bundlers and build
 *   tools.
 * - `percent` — the SVG is percent-encoded via `encodeURIComponent`
 *   plus a follow-up `'` tighten so the output is also safe inside a
 *   single-quoted CSS string. Typically smaller than base64 for
 *   textual SVG bodies.
 *
 * No DOM parser is used; size extraction reads the first opening
 * `<svg …>` tag with a quote-aware scanner and then inspects attribute
 * values. That's good enough for well-formed SVGs (which is all the
 * panel promises to handle); pathological markup falls back to the
 * no-size branch instead of blowing up.
 */

export type SvgToCssEncoding = 'base64' | 'percent';

export interface SvgSize {
  readonly width: number;
  readonly height: number;
}

export type SvgToCssResult =
  | {
      ok: true;
      /** Encoded `data:image/svg+xml;…` URI. */
      dataUri: string;
      /** Full CSS block (`background-image: …;` + optional size + repeat). */
      cssBlock: string;
      /** The encoding that produced `dataUri`. */
      encoding: SvgToCssEncoding;
      /** Detected natural size; omitted when neither width/height nor viewBox resolved. */
      size?: SvgSize;
    }
  | { ok: false; errorKey: string };

export interface SvgToCssOptions {
  readonly encoding: SvgToCssEncoding;
}

/** Hard cap on input byte length (UTF-8) before we refuse to encode. */
export const SVG_TO_CSS_MAX_BYTES = 100 * 1024; // 100 KB

/** Exposed for the panel's `error.tooLarge` interpolation. */
export const SVG_TO_CSS_MAX_KB = Math.round(SVG_TO_CSS_MAX_BYTES / 1024);

export function convertSvgToCss(svg: string, options: SvgToCssOptions): SvgToCssResult {
  const trimmed = svg.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.svgToCss.error.empty' };
  }

  const svgAttrs = readSvgOpeningTagAttributes(trimmed);
  if (svgAttrs === null) {
    return { ok: false, errorKey: 'utilities.tool.svgToCss.error.notSvg' };
  }

  const byteLength = new TextEncoder().encode(trimmed).byteLength;
  if (byteLength > SVG_TO_CSS_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.svgToCss.error.tooLarge' };
  }

  const size = extractSvgSize(svgAttrs);

  const payload =
    options.encoding === 'base64' ? encodeBase64Utf8(trimmed) : encodePercent(trimmed);

  const dataUri =
    options.encoding === 'base64'
      ? `data:image/svg+xml;base64,${payload}`
      : `data:image/svg+xml,${payload}`;

  const cssBlock = buildCssBlock(dataUri, size);

  const successful: SvgToCssResult = size
    ? { ok: true, dataUri, cssBlock, encoding: options.encoding, size }
    : { ok: true, dataUri, cssBlock, encoding: options.encoding };
  return successful;
}

function readSvgOpeningTagAttributes(svg: string): string | null {
  // Case-insensitive detection of `<svg` — tolerant of leading XML
  // declarations or DOCTYPE prologs above the root element.
  const match = /<svg\b/i.exec(svg);
  if (!match) {
    return null;
  }

  let quote: '"' | "'" | null = null;
  const attrsStart = match.index + match[0].length;
  for (let index = attrsStart; index < svg.length; index += 1) {
    const char = svg[index];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return svg.slice(attrsStart, index);
    }
  }

  return null;
}

function extractSvgSize(attrs: string): SvgSize | undefined {
  const widthRaw = readAttr(attrs, 'width');
  const heightRaw = readAttr(attrs, 'height');
  const width = parseFiniteNumber(widthRaw);
  const height = parseFiniteNumber(heightRaw);
  if (width !== null && height !== null) {
    return { width, height };
  }

  const viewBoxRaw = readAttr(attrs, 'viewBox');
  if (viewBoxRaw !== null) {
    const parts = viewBoxRaw.trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const vbWidth = parseFiniteNumber(parts[2] ?? '');
      const vbHeight = parseFiniteNumber(parts[3] ?? '');
      if (vbWidth !== null && vbHeight !== null) {
        return { width: vbWidth, height: vbHeight };
      }
    }
  }

  return undefined;
}

/**
 * Read an attribute value from the `<svg …>` opening-tag attribute string.
 * Supports double-quoted and single-quoted values; unquoted SVG attrs are
 * not a thing in the spec so we don't try to handle them.
 */
function readAttr(attrs: string, name: string): string | null {
  const escaped = name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
  const prefix = `(?:^|[\\s/])${escaped}\\s*=\\s*`;
  const double = attrs.match(new RegExp(`${prefix}"([^"]*)"`, 'i'));
  if (double) {
    return double[1] ?? '';
  }
  const single = attrs.match(new RegExp(`${prefix}'([^']*)'`, 'i'));
  if (single) {
    return single[1] ?? '';
  }
  return null;
}

function parseFiniteNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  // SVG width/height can be unitless or px. Percentages and other units
  // are relative to external layout, so they are not safe px hints.
  const match = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px)?$/i);
  if (!match || match[1] === undefined) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  // Reject zero and negative values: CSS `background-size` requires a
  // strictly positive length, and a 0-width SVG root is degenerate anyway.
  // Falls back to the viewBox branch, or `undefined` if both are bad.
  return Number.isFinite(value) && value > 0 ? value : null;
}

function encodeBase64Utf8(source: string): string {
  // `btoa` only accepts Latin-1; route non-ASCII codepoints through
  // UTF-8 first so emoji / ñ / CJK all round-trip correctly.
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodePercent(source: string): string {
  // `encodeURIComponent` already escapes every character that would
  // break a CSS `url("…")` wrapper: <, >, #, %, ", space, newline, tab.
  // It intentionally leaves `'` alone since ' is a reserved mark in
  // URIs — we tighten it here so the output is also safe inside a
  // single-quoted CSS string.
  return encodeURIComponent(source).replace(/'/g, '%27');
}

function buildCssBlock(dataUri: string, size: SvgSize | undefined): string {
  const lines: string[] = [`background-image: url("${dataUri}");`];
  if (size) {
    lines.push(`background-size: ${size.width}px ${size.height}px;`);
  }
  lines.push('background-repeat: no-repeat;');
  return lines.join('\n');
}

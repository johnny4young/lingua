import { decodeUrlComponentSafe } from '../../shared/utilities/urlComponent';
import { parseInAnyBase } from './numberBase';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface HslColor {
  h: number;
  s: number;
  l: number;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/u;
const HEX_SHORT_PATTERN = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu;
const HEX_LONG_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu;
const RGB_PATTERN =
  /^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*[\d.]+\s*)?\)$/iu;
const HSL_PATTERN =
  /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*(?:,\s*[\d.]+\s*)?\)$/iu;
const URL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u;
const URL_ENCODED_PATTERN = /%[0-9a-fA-F]{2}/u;
const HTML_ENTITY_PATTERN = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/u;
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/u;
const SVG_TAG_PATTERN = /<svg[\s>]/iu;
const DATA_URI_PATTERN = /^data:[^;]+;base64,/iu;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/u;
const NUMERIC_PATTERN = /^[+-]?(?:0[xXoObB])?[0-9a-zA-Z_]+$/u;
const ESCAPED_PATTERN = /\\(?:[nrt"'\\/bf]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/u;
const SQL_HINT_PATTERN = /\b(?:select|insert|update|delete|create|drop|alter|with)\b/iu;
const CRON_PATTERN =
  /^\s*(?:@(?:annually|yearly|monthly|weekly|daily|hourly|reboot)|(?:[\d*/,?L#-]+\s+){4,6}[\d*/,?L#-]+)\s*$/u;
const CURL_PATTERN = /^\s*curl\s+/u;
const MARKDOWN_HINT_PATTERN =
  /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|`[^`\n]+`|\*\*[^*]+\*\*)/u;
const YAML_HINT_PATTERN = /^[\s\S]*?(^|\n)[A-Za-z_][\w-]*:\s/u;
const CSV_HINT_PATTERN = /^[^\n]*?[,;\t][^\n]*(\n|$)/u;

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampByte(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 255) return null;
  return Math.round(value);
}

function hslToRgb({ h, s, l }: HslColor): RgbColor {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (hh >= 0 && hh < 1) {
    rPrime = c;
    gPrime = x;
  } else if (hh < 2) {
    rPrime = x;
    gPrime = c;
  } else if (hh < 3) {
    gPrime = c;
    bPrime = x;
  } else if (hh < 4) {
    gPrime = x;
    bPrime = c;
  } else if (hh < 5) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const m = lNorm - c / 2;
  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

/**
 * Shared color parser for both detection and the full utility analyzer.
 * Keeping it here lets Smart Paste validate colors without importing every
 * Developer Utilities implementation.
 */
export function parseColorToRgb(value: string): RgbColor | null {
  const shortHex = HEX_SHORT_PATTERN.exec(value);
  if (shortHex) {
    return {
      r: Number.parseInt(`${shortHex[1]}${shortHex[1]}`, 16),
      g: Number.parseInt(`${shortHex[2]}${shortHex[2]}`, 16),
      b: Number.parseInt(`${shortHex[3]}${shortHex[3]}`, 16),
    };
  }

  const longHex = HEX_LONG_PATTERN.exec(value);
  if (longHex) {
    return {
      r: Number.parseInt(longHex[1] ?? '00', 16),
      g: Number.parseInt(longHex[2] ?? '00', 16),
      b: Number.parseInt(longHex[3] ?? '00', 16),
    };
  }

  const rgbMatch = RGB_PATTERN.exec(value);
  if (rgbMatch) {
    const r = clampByte(Number.parseFloat(rgbMatch[1] ?? '0'));
    const g = clampByte(Number.parseFloat(rgbMatch[2] ?? '0'));
    const b = clampByte(Number.parseFloat(rgbMatch[3] ?? '0'));
    if (r === null || g === null || b === null) return null;
    return { r, g, b };
  }

  const hslMatch = HSL_PATTERN.exec(value);
  if (hslMatch) {
    const h = Number.parseFloat(hslMatch[1] ?? '0');
    const s = Number.parseFloat(hslMatch[2] ?? '0');
    const l = Number.parseFloat(hslMatch[3] ?? '0');
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
    if (s < 0 || s > 100 || l < 0 || l > 100) return null;
    return hslToRgb({ h: ((h % 360) + 360) % 360, s, l });
  }

  return null;
}

/**
 * Cheap synchronous predicates shared by panel Apply eligibility and Smart
 * Paste. They deliberately avoid the full analyzer module so editor startup
 * pays only for detection, while panel transformations remain on demand.
 */
export function detectsAsJson(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function detectsAsBase64(input: string): boolean {
  const trimmed = trimmedOrNull(input)?.replace(/\s+/gu, '');
  if (!trimmed || trimmed.length < 4 || trimmed.length % 4 !== 0) return false;
  if (!BASE64_PATTERN.test(trimmed) && !BASE64_URL_PATTERN.test(trimmed)) return false;
  return decodeBase64ForDetection(trimmed) !== null;
}

export function decodeBase64ForDetection(input: string): string | null {
  try {
    const binary = atob(input);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function detectsAsUrlEncoded(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(
    trimmed && URL_ENCODED_PATTERN.test(trimmed) && decodeUrlComponentSafe(trimmed) !== null
  );
}

export function detectsAsAbsoluteUrl(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed || !URL_LIKE_PATTERN.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function detectsAsJwt(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && JWT_PATTERN.test(trimmed));
}

export function detectsAsUuid(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && UUID_PATTERN.test(trimmed));
}

export function detectsAsTimestamp(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  const date = /^-?\d+$/u.test(trimmed)
    ? new Date(Number.parseInt(trimmed, 10) * (trimmed.length <= 10 ? 1000 : 1))
    : new Date(trimmed);
  return !Number.isNaN(date.getTime());
}

export function detectsAsRegex(input: string): boolean {
  if (!input) return false;
  try {
    new RegExp(input);
    return true;
  } catch {
    return false;
  }
}

export function detectsAsColor(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && parseColorToRgb(trimmed));
}

export function detectsAsNumber(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && NUMERIC_PATTERN.test(trimmed) && parseInAnyBase(trimmed, 10) !== null);
}

export function detectsAsHtml(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && HTML_TAG_PATTERN.test(trimmed));
}

export function detectsAsEncodedHtmlEntity(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && HTML_ENTITY_PATTERN.test(trimmed));
}

export function detectsAsHtmlEntity(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(
    trimmed && (detectsAsEncodedHtmlEntity(trimmed) || HTML_TAG_PATTERN.test(trimmed))
  );
}

export function detectsAsSvg(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && SVG_TAG_PATTERN.test(trimmed));
}

export function detectsAsDataUri(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && DATA_URI_PATTERN.test(trimmed));
}

export function detectsAsBackslashEscaped(input: string): boolean {
  return Boolean(input && ESCAPED_PATTERN.test(input));
}

export function detectsAsCron(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && CRON_PATTERN.test(trimmed));
}

export function detectsAsCurl(input: string): boolean {
  return Boolean(input && CURL_PATTERN.test(input));
}

export function detectsAsMarkdown(input: string): boolean {
  return Boolean(input && MARKDOWN_HINT_PATTERN.test(input));
}

export function detectsAsYaml(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return YAML_HINT_PATTERN.test(trimmed);
}

export function detectsAsCsv(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && CSV_HINT_PATTERN.test(trimmed));
}

export function detectsAsSql(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && SQL_HINT_PATTERN.test(trimmed));
}

export function detectsAsBeautifiable(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && trimmed.length >= 6 && /[{}();<>]/u.test(trimmed));
}

export function detectsAsInspectableText(input: string): boolean {
  return input.length > 0;
}

export function detectsAsCaseConvertible(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  return Boolean(trimmed && /[A-Za-z]/u.test(trimmed));
}

export function detectsAsHashable(input: string): boolean {
  return trimmedOrNull(input) !== null;
}

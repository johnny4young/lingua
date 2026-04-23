export interface JsonAnalysis {
  formatted: string | null;
  minified: string | null;
  parsed: unknown | null;
  errorKey: string | null;
}

export interface TransformResult {
  value: string | null;
  errorKey: string | null;
}

// `JwtAnalysis` and `decodeJwt` moved to `./jwt` alongside the new
// verify/sign surfaces for RL-071. Re-exported here so existing import
// sites (developerUtilities.ts was the historical home) keep compiling.
export type { JwtAnalysis } from './jwt';

export interface TimestampAnalysis {
  unixSeconds: number | null;
  unixMilliseconds: number | null;
  iso: string | null;
  local: string | null;
  errorKey: string | null;
}

export interface RegexMatchGroup {
  name: string | null;
  value: string;
}

export interface RegexMatch {
  match: string;
  index: number;
  groups: RegexMatchGroup[];
}

export interface RegexAnalysis {
  matches: RegexMatch[];
  truncated: boolean;
  errorKey: string | null;
}

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

export interface ColorAnalysis {
  hex: string | null;
  rgb: RgbColor | null;
  hsl: HslColor | null;
  errorKey: string | null;
}

export type DiffLineKind = 'same' | 'add' | 'remove';

export interface DiffLine {
  kind: DiffLineKind;
  value: string;
}

export interface LineDiffAnalysis {
  lines: DiffLine[];
  truncated: boolean;
  addCount: number;
  removeCount: number;
  sameCount: number;
}

const INDENT_SIZE = 2;
const REGEX_MATCH_LIMIT = 500;
const DIFF_MAX_INPUT_CHARS = 40_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// `normalizeBase64Url` and `parseJsonObject` moved to `./jwt` as private
// helpers alongside the decode/verify/sign surfaces for RL-071. No other
// consumer in this module needed them.

export function analyzeJson(value: string): JsonAnalysis {
  if (!value.trim()) {
    return {
      formatted: null,
      minified: null,
      parsed: null,
      errorKey: null,
    };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return {
      formatted: JSON.stringify(parsed, null, INDENT_SIZE),
      minified: JSON.stringify(parsed),
      parsed,
      errorKey: null,
    };
  } catch {
    return {
      formatted: null,
      minified: null,
      parsed: null,
      errorKey: 'utilities.tool.json.error',
    };
  }
}

export function encodeBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

export function decodeBase64(value: string): TransformResult {
  if (!value.trim()) {
    return {
      value: '',
      errorKey: null,
    };
  }

  try {
    const sanitized = value.replace(/\s+/gu, '');
    const bytes = base64ToBytes(sanitized);
    return {
      value: new TextDecoder().decode(bytes),
      errorKey: null,
    };
  } catch {
    return {
      value: null,
      errorKey: 'utilities.tool.base64.error',
    };
  }
}

export function encodeUrlComponentValue(value: string): string {
  return encodeURIComponent(value);
}

export function decodeUrlComponentValue(value: string): TransformResult {
  if (!value.trim()) {
    return {
      value: '',
      errorKey: null,
    };
  }

  try {
    return {
      value: decodeURIComponent(value),
      errorKey: null,
    };
  } catch {
    return {
      value: null,
      errorKey: 'utilities.tool.url.error',
    };
  }
}

export async function hashText(
  value: string,
  algorithm: 'SHA-1' | 'SHA-256'
): Promise<string> {
  const digest = await crypto.subtle.digest(
    algorithm,
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

// `decodeJwt` moved to `src/renderer/utils/jwt.ts` together with the new
// `verifyJwt` and `signJwt` surfaces for RL-071. Re-exported here so the
// existing import sites (developerUtilities.ts was the historical home)
// do not have to migrate in this commit.
export { decodeJwt } from './jwt';

export function analyzeTimestamp(value: string): TimestampAnalysis {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      unixSeconds: null,
      unixMilliseconds: null,
      iso: null,
      local: null,
      errorKey: null,
    };
  }

  let date: Date | null = null;

  if (/^-?\d+$/u.test(trimmed)) {
    const numeric = Number.parseInt(trimmed, 10);
    const milliseconds = trimmed.length <= 10 ? numeric * 1000 : numeric;
    date = new Date(milliseconds);
  } else {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return {
      unixSeconds: null,
      unixMilliseconds: null,
      iso: null,
      local: null,
      errorKey: 'utilities.tool.timestamp.error',
    };
  }

  const unixMilliseconds = date.getTime();

  return {
    unixSeconds: Math.floor(unixMilliseconds / 1000),
    unixMilliseconds,
    iso: date.toISOString(),
    local: date.toLocaleString(),
    errorKey: null,
  };
}

function toRegexMatch(result: RegExpMatchArray): RegexMatch {
  const groups: RegexMatchGroup[] = [];
  const namedGroups = result.groups ?? {};
  for (let index = 1; index < result.length; index += 1) {
    const value = result[index];
    if (typeof value !== 'string') {
      continue;
    }
    let name: string | null = null;
    for (const [candidateName, candidateValue] of Object.entries(namedGroups)) {
      if (candidateValue === value) {
        name = candidateName;
        break;
      }
    }
    groups.push({ name, value });
  }

  return {
    match: result[0] ?? '',
    index: result.index ?? 0,
    groups,
  };
}

export function analyzeRegex(
  pattern: string,
  flags: string,
  input: string
): RegexAnalysis {
  if (!pattern) {
    return { matches: [], truncated: false, errorKey: null };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return { matches: [], truncated: false, errorKey: 'utilities.tool.regex.errorPattern' };
  }

  if (!input) {
    return { matches: [], truncated: false, errorKey: null };
  }

  const matches: RegexMatch[] = [];
  let truncated = false;

  try {
    if (regex.global) {
      for (const result of input.matchAll(regex)) {
        if (matches.length >= REGEX_MATCH_LIMIT) {
          truncated = true;
          break;
        }
        matches.push(toRegexMatch(result));
      }
    } else {
      const result = input.match(regex);
      if (result !== null) {
        matches.push(toRegexMatch(result));
      }
    }
  } catch {
    return { matches: [], truncated: false, errorKey: 'utilities.tool.regex.errorExecution' };
  }

  return { matches, truncated, errorKey: null };
}

const HEX_SHORT_PATTERN = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu;
const HEX_LONG_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu;
const RGB_PATTERN =
  /^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*[\d.]+\s*)?\)$/iu;
const HSL_PATTERN =
  /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*(?:,\s*[\d.]+\s*)?\)$/iu;

function clampByte(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 255) return null;
  return Math.round(value);
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const toHex = (component: number) =>
    Math.max(0, Math.min(255, Math.round(component)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: round1(l * 100) };
  }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rNorm) {
    h = ((gNorm - bNorm) / delta) % 6;
  } else if (max === gNorm) {
    h = (bNorm - rNorm) / delta + 2;
  } else {
    h = (rNorm - gNorm) / delta + 4;
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s: round1(s * 100), l: round1(l * 100) };
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

function parseColorToRgb(value: string): RgbColor | null {
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
    if (r === null || g === null || b === null) {
      return null;
    }
    return { r, g, b };
  }

  const hslMatch = HSL_PATTERN.exec(value);
  if (hslMatch) {
    const h = Number.parseFloat(hslMatch[1] ?? '0');
    const s = Number.parseFloat(hslMatch[2] ?? '0');
    const l = Number.parseFloat(hslMatch[3] ?? '0');
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
      return null;
    }
    if (s < 0 || s > 100 || l < 0 || l > 100) {
      return null;
    }
    return hslToRgb({ h: ((h % 360) + 360) % 360, s, l });
  }

  return null;
}

export function analyzeColor(input: string): ColorAnalysis {
  const trimmed = input.trim();
  if (!trimmed) {
    return { hex: null, rgb: null, hsl: null, errorKey: null };
  }

  const rgb = parseColorToRgb(trimmed);
  if (!rgb) {
    return {
      hex: null,
      rgb: null,
      hsl: null,
      errorKey: 'utilities.tool.color.error',
    };
  }

  return {
    hex: rgbToHex(rgb),
    rgb,
    hsl: rgbToHsl(rgb),
    errorKey: null,
  };
}

function diffLcs(left: string[], right: string[]): DiffLine[] {
  const leftLen = left.length;
  const rightLen = right.length;
  const width = rightLen + 1;
  const table = new Uint32Array((leftLen + 1) * width);
  const cell = (row: number, col: number): number => table[row * width + col] ?? 0;

  for (let i = leftLen - 1; i >= 0; i -= 1) {
    for (let j = rightLen - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        table[i * width + j] = cell(i + 1, j + 1) + 1;
      } else {
        const down = cell(i + 1, j);
        const across = cell(i, j + 1);
        table[i * width + j] = down > across ? down : across;
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < leftLen && j < rightLen) {
    if (left[i] === right[j]) {
      out.push({ kind: 'same', value: left[i] ?? '' });
      i += 1;
      j += 1;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      out.push({ kind: 'remove', value: left[i] ?? '' });
      i += 1;
    } else {
      out.push({ kind: 'add', value: right[j] ?? '' });
      j += 1;
    }
  }
  while (i < leftLen) {
    out.push({ kind: 'remove', value: left[i] ?? '' });
    i += 1;
  }
  while (j < rightLen) {
    out.push({ kind: 'add', value: right[j] ?? '' });
    j += 1;
  }

  return out;
}

export function computeLineDiff(
  leftInput: string,
  rightInput: string
): LineDiffAnalysis {
  const truncated =
    leftInput.length > DIFF_MAX_INPUT_CHARS ||
    rightInput.length > DIFF_MAX_INPUT_CHARS;
  const left = truncated ? leftInput.slice(0, DIFF_MAX_INPUT_CHARS) : leftInput;
  const right = truncated ? rightInput.slice(0, DIFF_MAX_INPUT_CHARS) : rightInput;

  const leftLines = left === '' ? [] : left.split('\n');
  const rightLines = right === '' ? [] : right.split('\n');
  const lines = diffLcs(leftLines, rightLines);

  let addCount = 0;
  let removeCount = 0;
  let sameCount = 0;
  for (const entry of lines) {
    if (entry.kind === 'add') addCount += 1;
    else if (entry.kind === 'remove') removeCount += 1;
    else sameCount += 1;
  }

  return { lines, truncated, addCount, removeCount, sameCount };
}

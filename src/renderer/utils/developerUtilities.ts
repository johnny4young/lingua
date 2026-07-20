import { parseInAnyBase } from './numberBase';
// implementation note — URL component encode/decode live in the
// shared utilities layer (the `url-encode` / `url-decode` pipeline
// adapters) so the single-shot URL panel and the pipeline share one
// implementation of the actual encode/decode call.
import { decodeUrlComponentSafe, encodeUrlComponent } from '../../shared/utilities/urlComponent';

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
// verify/sign surfaces for internal Re-exported here so existing import
// sites (developerUtilities.ts was the historical home) keep compiling.
export type { JwtAnalysis } from './jwt';

export interface TimestampAnalysis {
  unixSeconds: number | null;
  unixMilliseconds: number | null;
  iso: string | null;
  local: string | null;
  utc: string | null;
  errorKey: string | null;
}

export interface TimestampHoverInfo {
  unixSeconds: number;
  unixMilliseconds: number;
  iso: string;
  local: string;
  utc: string;
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
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// `normalizeBase64Url` and `parseJsonObject` moved to `./jwt` as private
// helpers alongside the decode/verify/sign surfaces for internal No other
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
  return encodeUrlComponent(value);
}

export function decodeUrlComponentValue(value: string): TransformResult {
  // Preserve the panel UX short-circuit: whitespace-only decodes to an
  // empty string rather than echoing the spaces.
  if (!value.trim()) {
    return { value: '', errorKey: null };
  }
  const decoded = decodeUrlComponentSafe(value);
  return decoded === null
    ? { value: null, errorKey: 'utilities.tool.url.error' }
    : { value: decoded, errorKey: null };
}

/**
 * internal — Hash Generator. Supports five plain digests (MD5, SHA-1/256/384/512)
 * and HMAC variants for every SHA family member.
 *
 * - SHA digests route through `crypto.subtle.digest`, which is native in every
 *   supported browser + Node 18+.
 * - HMAC routes through `crypto.subtle.importKey` + `crypto.subtle.sign`. The
 *   key is a UTF-8-encoded user string; HMAC-MD5 is intentionally rejected
 *   (SubtleCrypto does not support it and modern protocols avoid it).
 * - MD5 lazy-imports `spark-md5` (MIT/WTFPL) so the ~10 KB gz module only
 *   lands in the DevUtils chunk when a user picks the MD5 algorithm.
 *
 * Inputs are always normalized to `ArrayBuffer` so text and file paths share
 * the same code path downstream. The 50 MB cap protects the renderer from
 * pathological file drops — SubtleCrypto has no streaming API, so we have to
 * hold the whole buffer in memory.
 */

export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type HashMode = 'plain' | 'hmac';

export const HASH_ALGORITHMS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export const HMAC_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;

/** Maximum accepted input byte length (text or file). */
export const HASH_FILE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
export const HASH_FILE_MAX_MB = Math.round(HASH_FILE_MAX_BYTES / (1024 * 1024));

export interface HashOptions {
  readonly algorithm: HashAlgorithm;
  readonly mode: HashMode;
  /** UTF-8 key, required when `mode === 'hmac'`. */
  readonly key?: string;
}

export type HashResult =
  | {
      ok: true;
      hex: string;
      algorithm: HashAlgorithm;
      mode: HashMode;
      /**
       * Size of the *input* that was hashed (not the digest). For text this
       * is the UTF-8 byte count; for file inputs this is `file.size`. The
       * panel surfaces it as a "Hashed N bytes" status line so users can
       * sanity-check the payload that went into the hash.
       */
      inputByteLength: number;
    }
  | {
      ok: false;
      errorKey: string;
      /** Raw library or platform message for the panel to render in a secondary line. */
      message?: string;
    };

/** Type of the dynamic `spark-md5` import. */
interface SparkMd5Module {
  default?: {
    ArrayBuffer: { hash(buffer: ArrayBuffer): string };
  };
  ArrayBuffer?: { hash(buffer: ArrayBuffer): string };
}

export async function computeHash(
  input: string | ArrayBuffer,
  options: HashOptions
): Promise<HashResult> {
  const buffer = toArrayBuffer(input);

  if (buffer.byteLength === 0) {
    return { ok: false, errorKey: 'utilities.tool.hash.error.empty' };
  }

  if (buffer.byteLength > HASH_FILE_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.hash.error.fileTooLarge' };
  }

  if (options.mode === 'hmac') {
    if (!options.key || options.key.length === 0) {
      return { ok: false, errorKey: 'utilities.tool.hash.error.emptyKey' };
    }
    if (options.algorithm === 'MD5') {
      return { ok: false, errorKey: 'utilities.tool.hash.error.unsupportedCombo' };
    }
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(options.key),
        { name: 'HMAC', hash: { name: options.algorithm } },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', key, buffer);
      return {
        ok: true,
        hex: bytesToHex(new Uint8Array(signature)),
        algorithm: options.algorithm,
        mode: 'hmac',
        inputByteLength: buffer.byteLength,
      };
    } catch (error) {
      return {
        ok: false,
        errorKey: 'utilities.tool.hash.error.execution',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Plain MD5 — lazy-load spark-md5.
  if (options.algorithm === 'MD5') {
    let sparkModule: SparkMd5Module;
    try {
      sparkModule = (await import('spark-md5')) as unknown as SparkMd5Module;
    } catch (error) {
      return {
        ok: false,
        errorKey: 'utilities.tool.hash.error.loadFailure',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const sparkApi = sparkModule.default?.ArrayBuffer ?? sparkModule.ArrayBuffer;
    if (!sparkApi || typeof sparkApi.hash !== 'function') {
      return {
        ok: false,
        errorKey: 'utilities.tool.hash.error.loadFailure',
        message: 'spark-md5 module did not expose an ArrayBuffer.hash entry point',
      };
    }
    try {
      const hex = sparkApi.hash(buffer);
      return {
        ok: true,
        hex,
        algorithm: 'MD5',
        mode: 'plain',
        inputByteLength: buffer.byteLength,
      };
    } catch (error) {
      return {
        ok: false,
        errorKey: 'utilities.tool.hash.error.execution',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Plain SHA family via SubtleCrypto.
  try {
    const digest = await crypto.subtle.digest(options.algorithm, buffer);
    return {
      ok: true,
      hex: bytesToHex(new Uint8Array(digest)),
      algorithm: options.algorithm,
      mode: 'plain',
      inputByteLength: buffer.byteLength,
    };
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.hash.error.execution',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function toArrayBuffer(input: string | ArrayBuffer): ArrayBuffer {
  if (typeof input === 'string') {
    // `TextEncoder.encode` returns a `Uint8Array` whose `.buffer` may be a
    // `SharedArrayBuffer` in theory; force a fresh copy to guarantee a real
    // `ArrayBuffer` for every downstream API (spark-md5 + SubtleCrypto both
    // require it).
    const bytes = new TextEncoder().encode(input);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
  }
  return input;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Thin text-to-hex wrapper retained for historical parity with the pre-internal
 * API. Routes through `computeHash` and throws on error to preserve the old
 * signature (pre-tagged-union callers).
 */
export async function hashText(
  value: string,
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
): Promise<string> {
  const result = await computeHash(value, { algorithm, mode: 'plain' });
  if (!result.ok) {
    throw new Error(result.message ?? result.errorKey);
  }
  return result.hex;
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

// `decodeJwt` moved to `src/renderer/utils/jwt.ts` together with the new
// `verifyJwt` and `signJwt` surfaces for internal Re-exported here so the
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
      utc: null,
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
      utc: null,
      errorKey: 'utilities.tool.timestamp.error',
    };
  }

  const unixMilliseconds = date.getTime();

  return {
    unixSeconds: Math.floor(unixMilliseconds / 1000),
    unixMilliseconds,
    iso: date.toISOString(),
    local: date.toLocaleString(),
    utc: `${formatTimestampDate(date, 'UTC')} UTC`,
    errorKey: null,
  };
}

const TIMESTAMP_MIN_MS = Date.UTC(2000, 0, 1);
const TIMESTAMP_MAX_MS = Date.UTC(2100, 0, 1);
const TIMESTAMP_CLAIM_KEYS = new Set([
  'iat',
  'exp',
  'nbf',
  'auth_time',
  'updated_at',
  'created_at',
]);

function formatTimestampDate(date: Date, timeZone?: string): string {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    ...(timeZone ? { timeZone } : {}),
  });
}

function numericTimestampToDate(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  const absolute = Math.abs(value);
  // Unix seconds are 10 digits for today's dates; Unix milliseconds are
  // 13 digits. Avoid shorter values so generic counters like "31" or
  // "2024" do not get timestamp chrome.
  const milliseconds = absolute < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Return hover metadata for values that are very likely to be timestamps.
 * Used by JSON/JWT renderers so machine-friendly epoch claims become human
 * readable without changing the copied JSON value.
 */
export function inspectTimestampLike(value: unknown, label?: string): TimestampHoverInfo | null {
  const normalizedLabel = label?.toLowerCase();
  const labelSuggestsTimestamp =
    normalizedLabel !== undefined && TIMESTAMP_CLAIM_KEYS.has(normalizedLabel);

  let date: Date | null = null;
  if (typeof value === 'number' && Number.isInteger(value)) {
    date = numericTimestampToDate(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d{10,13}$/u.test(trimmed)) {
      date = numericTimestampToDate(Number.parseInt(trimmed, 10));
    } else if (labelSuggestsTimestamp && trimmed.length > 0) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    }
  }

  if (!date) return null;
  const unixMilliseconds = date.getTime();
  const insideHumanRange =
    unixMilliseconds >= TIMESTAMP_MIN_MS && unixMilliseconds <= TIMESTAMP_MAX_MS;
  if (!insideHumanRange && !labelSuggestsTimestamp) return null;

  return {
    unixSeconds: Math.floor(unixMilliseconds / 1000),
    unixMilliseconds,
    iso: date.toISOString(),
    local: formatTimestampDate(date),
    utc: `${formatTimestampDate(date, 'UTC')} UTC`,
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

export function analyzeRegex(pattern: string, flags: string, input: string): RegexAnalysis {
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

export type RegexReplaceResult =
  | { ok: true; output: string; replacementCount: number; truncatedCount: boolean }
  | { ok: false; errorKey: string };

/**
 * Apply a regex replacement to `input`. Mirrors the error handling of
 * `analyzeRegex`: invalid pattern → tagged `{ ok: false, errorKey }`;
 * empty pattern → pass-through output with zero replacements.
 *
 * Replacement semantics defer to `String.prototype.replace` — `$1`,
 * `$2`, `$<name>`, `$&`, `$$` all expand exactly per the ECMAScript
 * spec (including literal pass-through of `$<name>` when the regex has
 * no named capture groups). We use a two-pass approach: first count
 * matches via `matchAll` (capped at `REGEX_MATCH_LIMIT` so the summary
 * stays honest on pathological inputs; the flag is surfaced via
 * `truncatedCount`), then run the native replace to produce `output`.
 * Two passes are bounded by the same cap and cost ~2x one regex scan
 * against the input — negligible at this limit and far simpler than
 * re-implementing template expansion inside a replacer callback.
 */
export function applyRegexReplace(
  pattern: string,
  flags: string,
  input: string,
  replacement: string
): RegexReplaceResult {
  if (!pattern) {
    return { ok: true, output: input, replacementCount: 0, truncatedCount: false };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return { ok: false, errorKey: 'utilities.tool.regex.errorPattern' };
  }

  let replacementCount = 0;
  let truncatedCount = false;
  try {
    if (regex.global) {
      // Count-only iteration — no match binding needed; the iterator's
      // completion state is all we consult. The clamp fires *after* the
      // Nth `next()` returns a match, which is why it sets `truncatedCount`
      // without incrementing past the limit.
      const iterator = input.matchAll(regex);
      while (!iterator.next().done) {
        if (replacementCount >= REGEX_MATCH_LIMIT) {
          truncatedCount = true;
          break;
        }
        replacementCount += 1;
      }
    } else if (regex.test(input)) {
      replacementCount = 1;
    }

    // Native template expansion — handles $1, $&, $<name>, $$ per spec,
    // including the literal-`$<name>` case when the regex has no named
    // captures. `replace` resets `lastIndex` internally for global regexes
    // and ignores it for non-global, so the prior `test()` call above
    // cannot leak state into this result.
    const output = input.replace(regex, replacement);
    return { ok: true, output, replacementCount, truncatedCount };
  } catch {
    return { ok: false, errorKey: 'utilities.tool.regex.errorExecution' };
  }
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

export function computeLineDiff(leftInput: string, rightInput: string): LineDiffAnalysis {
  const truncated =
    leftInput.length > DIFF_MAX_INPUT_CHARS || rightInput.length > DIFF_MAX_INPUT_CHARS;
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

/**
 * implementation — `detectsAs*` predicates.
 *
 * Each utility panel passes its current input through one of these
 * predicates to decide whether the ⚡ Apply-from-input button should
 * light up. The predicates are intentionally cheap (regex / parse
 * attempt) and reuse the existing analyzers where the parse step is
 * unavoidable — `detectsAsJson` calls `analyzeJson` so a malformed
 * payload returns false without re-parsing the same input twice in
 * the panel render path.
 */

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/u;
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/u;
const RGB_FUNC_PATTERN = /^rgba?\(/iu;
const HSL_FUNC_PATTERN = /^hsla?\(/iu;
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

export function detectsAsJson(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  // Cheap shape gate first — JSON.parse on arbitrary strings is the
  // expensive case. Empty literals like "true" / "42" / "\"x\"" are
  // valid JSON but we want detect to bias toward structural inputs
  // that benefit from the formatter; require an opening brace or
  // bracket.
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return false;
  return analyzeJson(trimmed).errorKey === null;
}

export function detectsAsBase64(input: string): boolean {
  const trimmed = trimmedOrNull(input)?.replace(/\s+/gu, '');
  if (!trimmed || trimmed.length < 4) return false;
  if (trimmed.length % 4 !== 0) return false;
  if (!BASE64_PATTERN.test(trimmed) && !BASE64_URL_PATTERN.test(trimmed)) {
    return false;
  }
  return decodeBase64(trimmed).errorKey === null;
}

export function detectsAsUrlEncoded(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  if (!URL_ENCODED_PATTERN.test(trimmed)) return false;
  return decodeUrlComponentValue(trimmed).errorKey === null;
}

export function detectsAsAbsoluteUrl(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  if (!URL_LIKE_PATTERN.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function detectsAsJwt(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return JWT_PATTERN.test(trimmed);
}

export function detectsAsUuid(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return UUID_PATTERN.test(trimmed);
}

export function detectsAsTimestamp(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return analyzeTimestamp(trimmed).errorKey === null;
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
  if (!trimmed) return false;
  if (
    !HEX_COLOR_PATTERN.test(trimmed) &&
    !RGB_FUNC_PATTERN.test(trimmed) &&
    !HSL_FUNC_PATTERN.test(trimmed)
  ) {
    return false;
  }
  return analyzeColor(trimmed).errorKey === null;
}

export function detectsAsNumber(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  if (!NUMERIC_PATTERN.test(trimmed)) return false;
  return parseInAnyBase(trimmed, 10) !== null;
}

export function detectsAsHtml(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return HTML_TAG_PATTERN.test(trimmed);
}

export function detectsAsHtmlEntity(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return detectsAsEncodedHtmlEntity(trimmed) || HTML_TAG_PATTERN.test(trimmed);
}

export function detectsAsEncodedHtmlEntity(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return HTML_ENTITY_PATTERN.test(trimmed);
}

export function detectsAsSvg(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return SVG_TAG_PATTERN.test(trimmed);
}

export function detectsAsDataUri(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return DATA_URI_PATTERN.test(trimmed);
}

export function detectsAsBackslashEscaped(input: string): boolean {
  if (!input) return false;
  return ESCAPED_PATTERN.test(input);
}

export function detectsAsCron(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return CRON_PATTERN.test(trimmed);
}

export function detectsAsCurl(input: string): boolean {
  if (!input) return false;
  return CURL_PATTERN.test(input);
}

export function detectsAsMarkdown(input: string): boolean {
  if (!input) return false;
  return MARKDOWN_HINT_PATTERN.test(input);
}

export function detectsAsYaml(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  // YAML and JSON overlap; this predicate biases toward the indented-
  // mapping shape (`key: value`) so a JSON paste does not trip it.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return YAML_HINT_PATTERN.test(trimmed);
}

export function detectsAsCsv(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return CSV_HINT_PATTERN.test(trimmed);
}

export function detectsAsSql(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return SQL_HINT_PATTERN.test(trimmed);
}

export function detectsAsBeautifiable(input: string): boolean {
  // The Beautify / Minify panel runs across JSON / JS / HTML / CSS /
  // XML, so detect biases toward "looks structured" — anything with
  // brackets, braces, semicolons, or angle brackets in non-trivial
  // amounts qualifies.
  const trimmed = trimmedOrNull(input);
  if (!trimmed || trimmed.length < 6) return false;
  return /[{}();<>]/u.test(trimmed);
}

export function detectsAsInspectableText(input: string): boolean {
  // String Inspector runs on any non-empty input; the value is in
  // having SOMETHING to inspect rather than matching a shape.
  return input.length > 0;
}

export function detectsAsCaseConvertible(input: string): boolean {
  const trimmed = trimmedOrNull(input);
  if (!trimmed) return false;
  return /[A-Za-z]/u.test(trimmed);
}

export function detectsAsHashable(input: string): boolean {
  // Hash works on any non-empty input — even single characters have a
  // legitimate digest. Whitespace-only strings are intentionally rejected
  // so the disabled state matches the analyzer's `error.empty` branch.
  return trimmedOrNull(input) !== null;
}

/**
 * RL-068 — Random String Generator helper.
 *
 * Pure, offline, renderer-side. Produces `count` strings of `length`
 * characters each, drawn from a user-selected character set using
 * Web Crypto's `getRandomValues` with rejection sampling to eliminate
 * modulo bias.
 *
 * No DOM, no network, no persisted state — safe to call from the
 * Electron renderer, the web build, and vitest's jsdom setup.
 */

export interface CharsetToggles {
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop chars that are visually ambiguous (0, O, o, 1, l, I, |). */
  excludeAmbiguous: boolean;
}

export const RANDOM_STRING_LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
export const RANDOM_STRING_UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const RANDOM_STRING_DIGITS = '0123456789';

/**
 * Symbol set picked to avoid chars that derail shell / JSON / YAML
 * contexts: no backslash, no backtick, no single / double quote.
 * Matches DevUtils + 1Password defaults.
 */
export const RANDOM_STRING_SYMBOLS = '!@#$%^&*()_+-={}[]|:;<>?,./';

/** Visually ambiguous glyphs we strip when the toggle is on. */
export const RANDOM_STRING_AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|']);

export type GenerateRandomStringsResult =
  | { ok: true; values: string[] }
  | { ok: false; kind: 'empty-charset' };

/**
 * Combine the selected classes into a single charset string, stripping
 * duplicates and (optionally) visually ambiguous chars. The result is
 * either an empty string (caller should surface `empty-charset`) or a
 * non-empty deduped character pool.
 */
export function buildCharset(toggles: CharsetToggles): string {
  let pool = '';
  if (toggles.lowercase) pool += RANDOM_STRING_LOWERCASE;
  if (toggles.uppercase) pool += RANDOM_STRING_UPPERCASE;
  if (toggles.digits) pool += RANDOM_STRING_DIGITS;
  if (toggles.symbols) pool += RANDOM_STRING_SYMBOLS;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const char of pool) {
    if (toggles.excludeAmbiguous && RANDOM_STRING_AMBIGUOUS.has(char)) continue;
    if (seen.has(char)) continue;
    seen.add(char);
    out.push(char);
  }
  return out.join('');
}

/**
 * Generate `count` random strings of `length` chars each, drawing
 * uniformly from `charset`. Uses `crypto.getRandomValues(Uint32Array)`
 * with rejection sampling: any draw `>= threshold` (where `threshold
 * = floor(UINT32_MAX / size) * size`) is discarded and re-drawn. This
 * keeps the sampler unbiased for arbitrary charset sizes.
 *
 * Returns a tagged-union result so the panel can surface the
 * `empty-charset` case without a try/catch.
 */
export function generateRandomStrings(
  length: number,
  count: number,
  charset: string
): GenerateRandomStringsResult {
  if (charset.length === 0) return { ok: false, kind: 'empty-charset' };
  if (length <= 0 || count <= 0) return { ok: true, values: [] };

  // Clamp inputs defensively so callers that forward raw user input
  // cannot ask us to allocate gigabytes.
  const effectiveLength = Math.min(Math.floor(length), 1024);
  const effectiveCount = Math.min(Math.floor(count), 100);

  const size = charset.length;
  // The Uint32 domain is `[0, 2^32)` — a span of `2^32` values (not
  // `2^32 - 1`). `threshold = floor(2^32 / size) * size` is the largest
  // multiple of `size` that fits inside the domain, so accepted draws
  // `[0, threshold)` cover exactly `threshold / size` full residue
  // classes. Using `0xFFFFFFFF` (= 2^32 - 1) as the numerator instead
  // would still produce unbiased output but would reject more valid
  // draws than necessary for common charset sizes (62, 26, 27, ...).
  const threshold = Math.floor(0x100000000 / size) * size;

  const values: string[] = [];
  for (let row = 0; row < effectiveCount; row += 1) {
    const chars: string[] = [];
    while (chars.length < effectiveLength) {
      // Draw in chunks sized to how many more chars we need — a little
      // oversized because some draws will be rejected.
      const needed = effectiveLength - chars.length;
      const drawSize = Math.max(needed * 2, 32);
      const buffer = new Uint32Array(drawSize);
      crypto.getRandomValues(buffer);
      for (let i = 0; i < buffer.length && chars.length < effectiveLength; i += 1) {
        const candidate = buffer[i] ?? 0;
        if (candidate >= threshold) continue; // rejection sampling
        chars.push(charset[candidate % size] ?? '');
      }
    }
    values.push(chars.join(''));
  }

  return { ok: true, values };
}

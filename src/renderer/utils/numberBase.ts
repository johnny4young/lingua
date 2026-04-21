/**
 * Pure helpers for the Number Base Converter utility (RL-068). All conversion
 * goes through `bigint` so arbitrarily large inputs round-trip losslessly —
 * `Number` would silently cap at 2^53-1 which is the exact failure mode that
 * makes converters like this untrustworthy. Everything here is pure; the
 * panel layer imports these and never duplicates the parsing rules.
 */

export const MIN_BASE = 2;
export const MAX_BASE = 36;

/** True when `n` is an integer within the valid base range [2, 36]. */
export function isValidBase(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_BASE && n <= MAX_BASE;
}

interface PrefixMatch {
  base: number;
  rest: string;
}

function stripPrefix(body: string): PrefixMatch | null {
  // Only honor a prefix when the caller didn't specify a base (the panel
  // passes the explicit base); this helper is reused inside `parseInAnyBase`
  // to auto-detect prefixes only when the input came from the decimal view.
  if (body.length < 2 || body[0] !== '0') return null;
  const tag = body[1]?.toLowerCase();
  if (tag === 'x') return { base: 16, rest: body.slice(2) };
  if (tag === 'o') return { base: 8, rest: body.slice(2) };
  if (tag === 'b') return { base: 2, rest: body.slice(2) };
  return null;
}

/**
 * Parse a string as an integer in the given base. Returns `null` for any
 * input the base can't represent — empty string, invalid characters, etc.
 *
 * - Underscores are permitted as digit separators and silently stripped
 *   (matches Rust / Python 3.6+ / JS numeric literal separators).
 * - An optional leading `-` or `+` is honored.
 * - When the base is 10, `0x` / `0o` / `0b` prefixes auto-switch the base so
 *   a user pasting `0xff` into the decimal view still converts cleanly.
 *
 * Base ranges outside [2, 36] return `null` rather than throwing — the panel
 * surfaces that as "invalid input" through the same red-border hint.
 */
export function parseInAnyBase(input: string, base: number): bigint | null {
  if (!isValidBase(base)) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let sign: 1n | -1n = 1n;
  let body = trimmed;
  if (body[0] === '+' || body[0] === '-') {
    if (body[0] === '-') sign = -1n;
    body = body.slice(1);
  }

  let effectiveBase = base;
  if (base === 10) {
    const prefixed = stripPrefix(body);
    if (prefixed) {
      effectiveBase = prefixed.base;
      body = prefixed.rest;
    }
  }

  const cleaned = body.replaceAll('_', '');
  if (cleaned.length === 0) return null;

  let value = 0n;
  const bigBase = BigInt(effectiveBase);
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (!char) return null;
    const digit = digitValue(char);
    if (digit < 0 || digit >= effectiveBase) return null;
    value = value * bigBase + BigInt(digit);
  }
  return sign * value;
}

/**
 * Format a bigint into the target base with letters UPPERCASED (consistency
 * with the hex view and with how Windows calc / xxd render). `bigint`
 * preserves sign, so `-255` in hex comes back as `-FF`.
 */
export function formatInBase(value: bigint, base: number): string {
  if (!isValidBase(base)) return '';
  return value.toString(base).toUpperCase();
}

function digitValue(char: string): number {
  const code = char.charCodeAt(0);
  // '0'..'9'
  if (code >= 48 && code <= 57) return code - 48;
  // 'a'..'z'
  if (code >= 97 && code <= 122) return code - 97 + 10;
  // 'A'..'Z'
  if (code >= 65 && code <= 90) return code - 65 + 10;
  return -1;
}

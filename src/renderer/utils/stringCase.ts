/**
 * internal — String Case Converter helper.
 *
 * Pure, offline, renderer-side. Splits an arbitrary string into a canonical
 * word list and re-emits it in seven common programmer casings. Unicode-aware:
 * uses `String.prototype.toLocaleLowerCase` / `toLocaleUpperCase` so accents
 * and non-Latin scripts round-trip correctly.
 *
 * Tokenizer rules:
 * - Whitespace, punctuation, and ASCII operator separators are dropped.
 * - Digit runs stay grouped and become their own token (`"v2"` → `['v','2']`).
 * - Case transitions split:
 *   - `fooBar` → `['foo','Bar']`
 *   - `foo_bar` → `['foo','bar']`
 *   - `HTTPRequest` → `['HTTP','Request']` (upper-run → upper+mixed boundary)
 *   - `HTMLTag` → `['HTML','Tag']`
 * - Tokens that contain no ASCII alphanumeric character are preserved whole
 *   (so CJK and emoji pass through unchanged).
 */

export interface CaseOutputs {
  camel: string;
  pascal: string;
  snake: string;
  kebab: string;
  constant: string;
  sentence: string;
  title: string;
}

const CASE_KEYS = ['camel', 'pascal', 'snake', 'kebab', 'constant', 'sentence', 'title'] as const;
export type CaseKey = (typeof CASE_KEYS)[number];
export const CASE_KEY_LIST: readonly CaseKey[] = CASE_KEYS;

const ASCII_LETTER = /[A-Za-z]/;
const ASCII_DIGIT = /[0-9]/;
const ASCII_ALNUM = /[A-Za-z0-9]/;

/**
 * Split `input` into a canonical, lowercase-preferring word list.
 * The function never throws and returns `[]` for empty / pure-separator input.
 */
export function toWords(input: string): string[] {
  if (!input) return [];

  const words: string[] = [];
  const runs = splitOnSeparators(input);

  for (const run of runs) {
    if (run.length === 0) continue;
    // Runs that have zero ASCII alphanumeric characters are kept whole —
    // think CJK, emoji, Arabic, etc. We neither case-implementation note split them.
    const hasAscii = Array.from(run).some((ch) => ASCII_ALNUM.test(ch));
    if (!hasAscii) {
      words.push(run);
      continue;
    }
    for (const piece of splitCamelRun(run)) {
      if (piece.length > 0) words.push(piece);
    }
  }

  return words;
}

function splitOnSeparators(input: string): string[] {
  const runs: string[] = [];
  let current = '';
  for (const ch of input) {
    if (isSeparator(ch)) {
      if (current.length > 0) {
        runs.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function isSeparator(ch: string): boolean {
  // Treat whitespace, punctuation, and ASCII operator symbols as separators
  // while preserving letters, digits, emoji, and other non-ASCII symbol runs
  // as part of the token stream.
  if (/[\p{White_Space}\p{P}]/u.test(ch)) return true;
  return ch.charCodeAt(0) <= 0x7f && !ASCII_ALNUM.test(ch);
}

/**
 * Split a contiguous run of alphanumerics on case boundaries and on
 * letter↔digit transitions. Pieces are returned in lowercase.
 */
function splitCamelRun(run: string): string[] {
  const chars = Array.from(run);
  const pieces: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer.length > 0) {
      pieces.push(buffer.toLocaleLowerCase());
      buffer = '';
    }
  };

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    const prev = chars[i - 1];
    const next = chars[i + 1];

    if (buffer.length === 0) {
      buffer = ch;
      continue;
    }

    const prevIsLetter = prev !== undefined && ASCII_LETTER.test(prev);
    const prevIsLower = prevIsLetter && prev === prev.toLocaleLowerCase();
    const prevIsUpper = prevIsLetter && prev === prev.toLocaleUpperCase();
    const prevIsDigit = prev !== undefined && ASCII_DIGIT.test(prev);
    const isUpper = ASCII_LETTER.test(ch) && ch === ch.toLocaleUpperCase();
    const isDigit = ASCII_DIGIT.test(ch);
    const nextIsLower =
      next !== undefined && ASCII_LETTER.test(next) && next === next.toLocaleLowerCase();

    // lower → Upper: split before the Upper (fooBar → foo | Bar).
    if (prevIsLower && isUpper) {
      flush();
      buffer = ch;
      continue;
    }

    // Upper → Upper followed by lower: split before the last Upper so
    // "HTTPRequest" yields ["HTTP","Request"] instead of ["HTTPRequest"].
    if (prevIsUpper && isUpper && nextIsLower) {
      flush();
      buffer = ch;
      continue;
    }

    // letter ↔ digit boundaries become their own break so "v2" → ["v","2"].
    if ((prevIsLetter && isDigit) || (prevIsDigit && !isDigit)) {
      flush();
      buffer = ch;
      continue;
    }

    buffer += ch;
  }

  flush();
  return pieces;
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  const first = word.slice(0, 1).toLocaleUpperCase();
  const rest = word.slice(1);
  return first + rest;
}

export function toCamel(input: string): string {
  const words = toWords(input);
  if (words.length === 0) return '';
  const [head, ...rest] = words;
  return [head ?? '', ...rest.map(capitalize)].join('');
}

export function toPascal(input: string): string {
  const words = toWords(input);
  if (words.length === 0) return '';
  return words.map(capitalize).join('');
}

export function toSnake(input: string): string {
  return toWords(input).join('_');
}

export function toKebab(input: string): string {
  return toWords(input).join('-');
}

export function toConstant(input: string): string {
  return toWords(input)
    .map((word) => word.toLocaleUpperCase())
    .join('_');
}

export function toSentence(input: string): string {
  const words = toWords(input);
  if (words.length === 0) return '';
  const [head, ...rest] = words;
  return [capitalize(head ?? ''), ...rest].join(' ');
}

export function toTitle(input: string): string {
  return toWords(input).map(capitalize).join(' ');
}

/**
 * Emit every supported casing at once. Handy for panel rendering where
 * each output cell shares the same token pass.
 */
export function formatAllCases(input: string): CaseOutputs {
  return {
    camel: toCamel(input),
    pascal: toPascal(input),
    snake: toSnake(input),
    kebab: toKebab(input),
    constant: toConstant(input),
    sentence: toSentence(input),
    title: toTitle(input),
  };
}

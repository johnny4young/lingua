/** JSON has no Infinity or NaN, so result cells carry them as this text. */
const NON_FINITE = new Map<unknown, number>([
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['NaN', Number.NaN],
]);

/** The number a non-finite cell stands for, or null for any other value. */
export const nonFiniteNumber = (value: unknown): number | null => NON_FINITE.get(value) ?? null;

/** Ascending order as the engines sort: NaN equals itself and goes above Infinity. */
export function compareNumbers(a: number, b: number): number {
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);
  if (aNaN || bNaN) return Number(aNaN) - Number(bNaN);
  return a < b ? -1 : a > b ? 1 : 0;
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const MINUS = 0x2d;
const LETTER_I = 0x49;
const LETTER_N = 0x4e;
const INFINITY_LENGTH = 8;
const NAN_LENGTH = 3;

/**
 * DuckDB's JSON writer leaves these values bare (`{"x":Infinity}`), which no
 * JSON parser reads. Quotes them so a file matches what the grid shows.
 */
export function quoteNonFiniteJson(bytes: Uint8Array): Uint8Array {
  const tokens: Array<{ start: number; end: number }> = [];
  let inString = false;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    if (inString) {
      if (byte === BACKSLASH) i += 1;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) {
      inString = true;
    } else if (byte === LETTER_N || byte === LETTER_I || (byte === MINUS && bytes[i + 1] === LETTER_I)) {
      // Outside a string valid JSON has no capital letters, so these start a token.
      const length = byte === LETTER_N ? NAN_LENGTH : byte === MINUS ? INFINITY_LENGTH + 1 : INFINITY_LENGTH;
      tokens.push({ start: i, end: i + length });
      i += length - 1;
    }
  }
  if (tokens.length === 0) return bytes;
  const out = new Uint8Array(bytes.length + tokens.length * 2);
  let read = 0;
  let write = 0;
  for (const { start, end } of tokens) {
    out.set(bytes.subarray(read, start), write);
    write += start - read;
    out[write++] = QUOTE;
    out.set(bytes.subarray(start, end), write);
    write += end - start;
    out[write++] = QUOTE;
    read = end;
  }
  out.set(bytes.subarray(read), write);
  return out;
}

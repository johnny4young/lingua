/**
 * Output-bounded decoder for lz-string's URI-safe format.
 *
 * Adapted from lz-string 1.5.0's MIT-licensed `_decompress` routine,
 * Copyright (c) 2013 Pieroxy. The important difference is that this decoder
 * stops before appending an entry that would cross the caller's code-unit
 * ceiling, so a compact compression bomb never materializes in memory first.
 */

const URI_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const URI_SAFE_VALUE = new Map(
  [...URI_SAFE_ALPHABET].map((character, index) => [character, index] as const)
);

export type BoundedDecompressionResult =
  | { readonly status: 'ok'; readonly value: string }
  | { readonly status: 'invalid' }
  | { readonly status: 'too-large' };

export function decompressUriComponentBounded(
  compressed: string,
  maxOutputCodeUnits: number
): BoundedDecompressionResult {
  if (compressed.length === 0 || maxOutputCodeUnits < 1) return { status: 'invalid' };
  const input = compressed.replace(/ /gu, '+');
  const values = [...input].map(character => URI_SAFE_VALUE.get(character));
  if (values.some(value => value === undefined)) return { status: 'invalid' };

  let value = values[0] ?? 0;
  let position = 32;
  let index = 1;

  const readBits = (width: number): number | null => {
    let bits = 0;
    let power = 1;
    const limit = 2 ** width;
    while (power !== limit) {
      if (position === 0) {
        if (index >= values.length) return null;
        position = 32;
        value = values[index] ?? 0;
        index += 1;
      }
      const bit = value & position;
      position >>= 1;
      if (bit > 0) bits += power;
      power <<= 1;
    }
    return bits;
  };

  const dictionary: Array<string | number> = [0, 1, 2];
  let enlargeIn = 4;
  let dictionarySize = 4;
  let bitWidth = 3;

  const firstKind = readBits(2);
  if (firstKind === null) return { status: 'invalid' };
  const firstCode = firstKind === 0 ? readBits(8) : firstKind === 1 ? readBits(16) : null;
  if (firstKind === 2) return { status: 'ok', value: '' };
  if (firstCode === null) return { status: 'invalid' };

  let previous = String.fromCharCode(firstCode);
  dictionary[3] = previous;
  const output = [previous];
  let outputCodeUnits = previous.length;

  while (true) {
    const nextCode = readBits(bitWidth);
    if (nextCode === null) return { status: 'invalid' };
    let code = nextCode;

    if (code === 0 || code === 1) {
      const literal = readBits(code === 0 ? 8 : 16);
      if (literal === null) return { status: 'invalid' };
      dictionary[dictionarySize] = String.fromCharCode(literal);
      code = dictionarySize;
      dictionarySize += 1;
      enlargeIn -= 1;
    } else if (code === 2) {
      return { status: 'ok', value: output.join('') };
    }

    if (enlargeIn === 0) {
      enlargeIn = 2 ** bitWidth;
      bitWidth += 1;
    }

    const candidate = dictionary[code];
    const entry =
      typeof candidate === 'string'
        ? candidate
        : code === dictionarySize
          ? previous + previous.charAt(0)
          : null;
    if (entry === null) return { status: 'invalid' };
    if (outputCodeUnits + entry.length > maxOutputCodeUnits) {
      return { status: 'too-large' };
    }

    output.push(entry);
    outputCodeUnits += entry.length;
    dictionary[dictionarySize] = previous + entry.charAt(0);
    dictionarySize += 1;
    enlargeIn -= 1;
    previous = entry;

    if (enlargeIn === 0) {
      enlargeIn = 2 ** bitWidth;
      bitWidth += 1;
    }
  }
}

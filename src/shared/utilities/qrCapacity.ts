/**
 * QR symbol version for a text at error correction level M, from the ISO/IEC
 * 18004 capacity table, so a preview never loads the QR encoder.
 */

/** Characters each version 1–40 holds at level M, per encoding mode. */
const NUMERIC_M = [
  34, 63, 101, 149, 202, 255, 293, 365, 432, 513, 604, 691, 796, 871, 991, 1082, 1212, 1346, 1500, 1600,
  1708, 1872, 2059, 2188, 2395, 2544, 2701, 2857, 3035, 3289, 3486, 3693, 3909, 4134, 4343, 4588, 4775,
  5039, 5313, 5596,
];
const ALPHANUMERIC_M = [
  20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656, 734, 816, 909, 970, 1035,
  1134, 1248, 1326, 1451, 1542, 1637, 1732, 1839, 1994, 2113, 2238, 2369, 2506, 2632, 2780, 2894, 3054,
  3220, 3391,
];
const BYTE_M = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711,
  779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213,
  2331,
];

const NUMERIC = /^\d*$/u;
const ALPHANUMERIC = /^[\d A-Z$%*+\-./:]*$/u;

/** The smallest version that holds `text` in one mode, or null past version 40 or for empty text. */
export function qrVersionAtM(text: string): number | null {
  if (text.length === 0) return null;
  const [table, size] = NUMERIC.test(text)
    ? [NUMERIC_M, text.length]
    : ALPHANUMERIC.test(text)
      ? [ALPHANUMERIC_M, text.length]
      : [BYTE_M, new TextEncoder().encode(text).length];
  const index = table.findIndex((capacity) => size <= capacity);
  return index < 0 ? null : index + 1;
}

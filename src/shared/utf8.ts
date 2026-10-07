/**
 * UTF-8 byte helpers for runner results, CLI output, capsules and share stdin.
 *
 * Three copies of "how many bytes is this string" and two incompatible
 * truncators used to live in the CLI, the capsule sanitiser and the worker
 * result limits. The worker one sliced by UTF-16 code units against a byte
 * budget, so CJK or emoji payloads passed three to four times the nominal
 * cap and could end on a lone surrogate. This module is the single
 * implementation; it uses TextEncoder/TextDecoder only, so it runs in Web
 * Workers, the renderer, the Electron main process and the Node CLI alike.
 */

const encoder = new TextEncoder();
// U+FEFF is payload data, not a transport BOM to strip from a kept prefix.
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** UTF-8 byte length of a string. */
export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/**
 * Longest prefix of `value` that fits in `maxBytes` bytes of UTF-8.
 *
 * Cuts on a code point boundary by walking back over continuation bytes, so
 * a multibyte character is either kept whole or dropped whole; decoding the
 * kept bytes can therefore never produce a lone surrogate. Returns the input
 * unchanged when it already fits.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  return decodePrefix(bytes, maxBytes);
}

/**
 * Clip `value` and `marker` together into `maxBytes` of UTF-8.
 *
 * Text that already fits is returned unchanged. Otherwise the marker is
 * reserved first (itself cut to a code-point-safe prefix when it exceeds the
 * budget) and the longest fitting source prefix fills the remaining room, so
 * neither side is ever forced past the cap. Fractional budgets round down to
 * whole bytes and negative budgets capture nothing.
 */
export function truncateUtf8WithMarker(value: string, maxBytes: number, marker: string): string {
  const budget = Math.max(0, Math.floor(maxBytes));
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= budget) return value;
  const boundedMarker = truncateUtf8(marker, budget);
  const headroom = budget - utf8ByteLength(boundedMarker);
  return `${decodePrefix(bytes, headroom)}${boundedMarker}`;
}

/** Decode the longest whole-code-point prefix of `bytes` within `maxBytes`. */
function decodePrefix(bytes: Uint8Array, maxBytes: number): string {
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.subarray(0, end));
}

import { truncateUtf8, utf8ByteLength } from '../../shared/utf8';

/**
 * Bound captured native text and its marker together in UTF-8 bytes.
 * The marker is a code-point-safe prefix when it exceeds the cap; no source
 * character is forced past the budget. Exact-limit text stays unchanged.
 * Fractional caps round down to whole bytes; negative caps capture nothing.
 * Every main-process output cap uses this helper; the former UTF-16
 * code-unit truncator could exceed byte caps and split surrogate pairs.
 */
export function truncateNativeOutputUtf8(value: string, maxBytes: number, marker: string): string {
  const budget = Math.max(0, Math.floor(maxBytes));
  if (utf8ByteLength(value) <= budget) return value;
  const boundedMarker = truncateUtf8(marker, budget);
  const headroom = budget - utf8ByteLength(boundedMarker);
  return `${truncateUtf8(value, headroom)}${boundedMarker}`;
}

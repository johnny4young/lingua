import { truncateUtf8WithMarker } from '../../shared/utf8';

/**
 * Bound captured native text and its marker together in UTF-8 bytes.
 * The marker is a code-point-safe prefix when it exceeds the cap; no source
 * character is forced past the budget. Exact-limit text stays unchanged.
 * Fractional caps round down to whole bytes; negative caps capture nothing.
 * Native runs, native installs, and Go/Rust compile diagnostics use this
 * helper; the former UTF-16 code-unit truncator could exceed byte caps and
 * split surrogate pairs.
 */
export function truncateNativeOutputUtf8(value: string, maxBytes: number, marker: string): string {
  return truncateUtf8WithMarker(value, maxBytes, marker);
}

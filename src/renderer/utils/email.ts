/**
 * Lightweight client-side email shape check.
 *
 * This is deliberately permissive — the authoritative validation lives
 * on the trial / education worker. The renderer only needs "does this
 * look like an email at all?" so it can flag an obviously-malformed
 * value inline (aria-invalid + an error message) BEFORE a network round
 * trip, instead of bouncing the user off a server toast. It must not
 * reject valid-but-unusual addresses, so it stays intentionally loose:
 * a non-empty local part, one `@`, and a dotted domain.
 */
const LIKELY_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmail(value: string): boolean {
  return LIKELY_EMAIL.test(value.trim());
}

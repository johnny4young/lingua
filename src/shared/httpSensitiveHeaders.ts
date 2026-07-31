/**
 * Startup-safe HTTP privacy policy.
 *
 * Keep this module as a dependency leaf: Settings needs the immutable baseline
 * during bootstrap, but it must not pull the complete HTTP workspace schema,
 * parsers, capture rules, assertions, and serializers into the initial graph.
 */

/**
 * Header names that are always redacted. Users may add names in Settings, but
 * they cannot remove these defaults.
 *
 * Comparison is case-insensitive per RFC 9110 section 5.1.
 */
export const BASELINE_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
] as const;

const BASELINE_SENSITIVE_HEADER_SET: ReadonlySet<string> = new Set(BASELINE_SENSITIVE_HEADERS);

/** Return whether a value is an exact baseline header name after normalization. */
export function isBaselineSensitiveHttpHeader(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const normalized = name.trim().toLowerCase();
  return normalized.length > 0 && BASELINE_SENSITIVE_HEADER_SET.has(normalized);
}

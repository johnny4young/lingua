/**
 * HTTP workspace behavioral implementation and compatibility facade.
 *
 * The dependency-safe request/response shapes, limits, enums, and blank
 * request factory live in `httpWorkspaceSchema.ts`. Strict persistence
 * validation lives in `httpWorkspacePersistence.ts`. This module preserves
 * the historical public facade while owning auth composition and cURL
 * serialization. Query synchronization, response captures, and assertions
 * live in dedicated dependency-light modules.
 *
 * Privacy posture:
 *
 *   - Header redaction happens at WRITE time, not at READ time. The
 *     persisted store already holds redacted entries (sensitive headers were
 *     never written to disk in plain).
 *   - Response metadata lists redacted header names, never their values.
 *   - Size caps prevent both DoS and storage exhaustion: 1 MiB on request
 *     bodies and 4 MiB on response bodies.
 */

import { isBaselineSensitiveHttpHeader } from './httpSensitiveHeaders';
import type {
  HttpRequestAuth,
  HttpRequestV1,
} from './httpWorkspaceSchema';

// Historical facade: existing activated callers may keep this import path.
export { BASELINE_SENSITIVE_HEADERS } from './httpSensitiveHeaders';
export { parseHttpRequest, parseHttpResponse } from './httpWorkspacePersistence';
export * from './httpWorkspaceAssertions';
export * from './httpWorkspaceCaptures';
export * from './httpWorkspaceQuery';
export * from './httpWorkspaceSchema';

/**
 * Helper: decide whether a header name is sensitive. Used by the
 * runtime + the UI's "headers redacted" badge. Comparison is
 * case-insensitive per RFC 7230. The baseline list always applies;
 * the user's allowlist is additive (never subtracts from baseline).
 */
export function isHeaderSensitive(
  headerName: string,
  userAllowlist: readonly string[]
): boolean {
  if (typeof headerName !== 'string' || headerName.length === 0) return false;
  const lc = headerName.toLowerCase().trim();
  if (lc.length === 0) return false;
  if (isBaselineSensitiveHttpHeader(lc)) {
    return true;
  }
  for (const allow of userAllowlist) {
    if (typeof allow !== 'string') continue;
    if (allow.toLowerCase().trim() === lc) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Auth header injection. Pure — the runtime applies the result before
// sending; the curl builder reuses it so the printed command matches
// the wire request exactly.
// ---------------------------------------------------------------------------

/**
 * UTF-8-safe base64 for Basic auth. `btoa` only handles Latin-1, so a
 * username / password with non-ASCII bytes would throw — encode to
 * UTF-8 bytes first.
 */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** Default header name when an API-key auth row leaves it blank. */
export const DEFAULT_API_KEY_HEADER = 'X-API-Key';

/**
 * Resolve the auth config into the single header it injects, or `null`
 * for `'none'` / incomplete config (e.g. a bearer scheme with an empty
 * token injects nothing — the user is still filling it in). Header
 * names are always baseline-sensitive, so the response/capsule
 * redaction covers the resulting request.
 */
export function buildAuthHeader(
  auth: HttpRequestAuth | undefined
): { name: string; value: string } | null {
  if (!auth || auth.kind === 'none') return null;
  if (auth.kind === 'bearer') {
    const token = auth.token ?? '';
    if (token.length === 0) return null;
    return { name: 'Authorization', value: `Bearer ${token}` };
  }
  if (auth.kind === 'basic') {
    const username = auth.username ?? '';
    const password = auth.password ?? '';
    if (username.length === 0 && password.length === 0) return null;
    return {
      name: 'Authorization',
      value: `Basic ${base64Utf8(`${username}:${password}`)}`,
    };
  }
  // apiKey
  const headerName = (auth.apiKeyHeader ?? '').trim() || DEFAULT_API_KEY_HEADER;
  const headerValue = auth.apiKeyValue ?? '';
  if (headerValue.length === 0) return null;
  return { name: headerName, value: headerValue };
}

/**
 * The header NAME the auth config injects, regardless of whether the
 * value is filled in yet — `'Authorization'` for bearer/basic, the
 * custom `apiKeyHeader` (default `X-API-Key`) for apiKey, `null` for
 * `'none'`.
 *
 * Security: the capsule serializer must redact the auth-injected header
 * unconditionally. `buildAuthHeader` only returns non-null once a value
 * is present, and `isHeaderSensitive` only knows the baseline +
 * user-allowlisted names — so a `kind: 'apiKey'` request with a CUSTOM
 * header name (e.g. `X-Custom-Auth`, not in the baseline) would have
 * leaked its value in clear into share-links / CLI replay / AI prompts.
 * This helper closes that gap by naming the injected header for callers
 * that redact by name.
 */
export function authInjectedHeaderName(
  auth: HttpRequestAuth | undefined
): string | null {
  if (!auth || auth.kind === 'none') return null;
  if (auth.kind === 'bearer' || auth.kind === 'basic') return 'Authorization';
  return (auth.apiKeyHeader ?? '').trim() || DEFAULT_API_KEY_HEADER;
}

/**
 * Compose the full outgoing header list for a request: the user's
 * enabled header rows PLUS the injected auth header (auth wins on a
 * name collision — the explicit Auth sub-tab is the more specific
 * intent). Empty-name rows are dropped. Pure: the runtime feeds this
 * into a `Headers` instance; the curl builder prints it verbatim.
 */
export function composeRequestHeaders(
  request: HttpRequestV1
): Array<{ name: string; value: string }> {
  const injected = buildAuthHeader(request.auth);
  const injectedLc = injected ? injected.name.toLowerCase() : null;
  const out: Array<{ name: string; value: string }> = [];
  for (const header of request.headers) {
    if (!header.enabled) continue;
    const name = header.name.trim();
    if (name.length === 0) continue;
    // Auth header takes precedence over a same-named manual row.
    if (injectedLc !== null && name.toLowerCase() === injectedLc) continue;
    out.push({ name, value: header.value });
  }
  if (injected) out.push(injected);
  return out;
}

// ---------------------------------------------------------------------------
// Copy as cURL. Builds a shell-safe `curl` command from the resolved
// request (method, URL incl. params, composed headers incl. auth, body).
// ---------------------------------------------------------------------------

/**
 * Single-quote a token for a POSIX shell. Wraps in `'…'` and escapes
 * embedded single quotes via the `'\''` idiom — safe for arbitrary
 * bytes (no interpolation happens inside single quotes).
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a `curl` command string equivalent to sending `request`. The
 * URL already carries the query params (the editor keeps `url` in sync
 * with the Params table), so no extra param handling is needed here.
 * Auth is injected via `composeRequestHeaders`, so the printed `-H`
 * lines match the wire request. The body is emitted via `--data` for
 * non-none kinds on methods that carry a body.
 *
 * Content-Type fidelity: the runtime (`buildRequestHeaders`) auto-adds
 * a default `Content-Type` for JSON / form / text bodies when the user
 * did not set one explicitly. We mirror that here so the printed `-H`
 * lines match the bytes actually sent — without it, `curl` would
 * default a `--data` body to `application/x-www-form-urlencoded` and
 * the copied command would diverge from the wire request.
 *
 * NOTE: this prints the user's ACTUAL header / token values (it is a
 * copy-MY-request affordance, like Chrome DevTools "Copy as cURL"),
 * not the redacted shape. Redaction is a telemetry / share guarantee;
 * the clipboard is the user's own surface.
 *
 * implementation note — ENVIRONMENT SECRET EXCEPTION. The
 * "clipboard is the user's own surface" philosophy holds for values the
 * user TYPED. It does NOT hold for environment secrets: a `{{key}}`
 * bound to a `secret: true` env var would otherwise be resolved into
 * the clipboard. Callers with an active environment must pre-process the
 * request through `maskSecretsForCapsule(request, env)` BEFORE passing
 * it here, so non-secret vars resolve (the command stays runnable) but
 * secret vars print as their `{{key}}` placeholder (no clipboard leak).
 * This function itself is env-agnostic — it prints whatever request it
 * is handed; the masking is the caller's responsibility.
 */
export function buildCurlCommand(request: HttpRequestV1): string {
  const parts: string[] = ['curl'];
  if (request.method !== 'GET') {
    parts.push('-X', request.method);
  }
  parts.push(shellQuote(request.url));
  const composed = composeRequestHeaders(request);
  for (const header of composed) {
    parts.push('-H', shellQuote(`${header.name}: ${header.value}`));
  }
  const carriesBody =
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    request.method !== 'OPTIONS';
  const willSendBody =
    carriesBody &&
    !!request.body &&
    request.body.kind !== 'none' &&
    (request.body.content ?? '').length > 0;
  if (willSendBody && request.body) {
    // Mirror the runtime's default Content-Type injection so the copied
    // command sends the same bytes. Only fires when the user has not
    // already supplied a Content-Type row (case-insensitive).
    const hasContentType = composed.some(
      (h) => h.name.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
      const defaultContentType =
        request.body.kind === 'json'
          ? 'application/json'
          : request.body.kind === 'form'
            ? 'application/x-www-form-urlencoded'
            : request.body.kind === 'text'
              ? 'text/plain'
              : null;
      if (defaultContentType !== null) {
        parts.push('-H', shellQuote(`Content-Type: ${defaultContentType}`));
      }
    }
    parts.push('--data', shellQuote(request.body.content ?? ''));
  }
  return parts.join(' ');
}

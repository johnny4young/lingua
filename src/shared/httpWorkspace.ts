/**
 * HTTP workspace behavioral implementation and compatibility facade.
 *
 * The dependency-safe request/response shapes, limits, enums, and blank
 * request factory live in `httpWorkspaceSchema.ts`. Strict persistence
 * validation lives in `httpWorkspacePersistence.ts`. This module preserves
 * the historical public facade while owning cURL serialization. Header
 * resolution, query synchronization, response captures, and assertions live
 * in dedicated dependency-light modules.
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

import { composeRequestHeaders } from './httpWorkspaceHeaders';
import type { HttpRequestV1 } from './httpWorkspaceSchema';

// Historical facade: existing activated callers may keep this import path.
export { BASELINE_SENSITIVE_HEADERS } from './httpSensitiveHeaders';
export { parseHttpRequest, parseHttpResponse } from './httpWorkspacePersistence';
export * from './httpWorkspaceAssertions';
export * from './httpWorkspaceCaptures';
export * from './httpWorkspaceHeaders';
export * from './httpWorkspaceQuery';
export * from './httpWorkspaceSchema';

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

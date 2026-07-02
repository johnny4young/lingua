/**
 * RL-097 Slice 1 — Build a `RunCapsuleV1` from an HTTP request +
 * response pair.
 *
 * The capsule wraps the HTTP exchange in the same wire format every
 * other Lingua run uses (script execution, future SQL queries,
 * future pipelines). That means share-links, CLI replay, AI prompt
 * inclusion, and history export ALL handle HTTP responses through
 * the same redaction + size + version-migration machinery without
 * special-casing the HTTP path.
 *
 * Mapping rules:
 *
 *   - `tab.language = 'http'` — distinguishes HTTP capsules from
 *     `'javascript'` / `'python'` / etc. so the consumer can render
 *     them with the right surface.
 *   - `tab.runtimeMode = 'http-client'` + `environment.runner = 'http-client'`
 *     — reserved literal that the existing capsule shape allows.
 *   - `source.content` carries the request shape as a deterministic
 *     JSON serialization (method + URL + sorted headers + body). The
 *     content-hash on that string lets the consumer dedup repeats.
 *   - `result.status` maps HTTP outcome to capsule outcome:
 *     `'2xx'/'3xx'` → `'success'`, `'4xx'/'5xx'/'cors-error'` →
 *     `'error'`, `'timeout'` → `'timeout'`, network failures → `'error'`.
 *   - `result.stdout` carries the redacted response body.
 *   - `result.stderr` carries the error message (when present).
 *   - `result.durationMs` mirrors the response's duration.
 *
 * The existing capsule sanitiser (`sanitizeRunCapsule`) handles
 * additional defense-in-depth redaction so the EXPORTED capsule
 * never carries secrets even if the renderer somehow recorded them.
 */

import {
  buildRunCapsule,
  type RunCapsuleStatus,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import {
  authInjectedHeaderName,
  composeRequestHeaders,
  isHeaderSensitive,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../../shared/httpWorkspace';

/**
 * Map the response kind to the capsule status enum. HTTP 3xx redirects
 * normally land here as `'success'` because the fetch layer follows
 * redirects by default, so the renderer sees the final 2xx/4xx/5xx
 * after the redirect chain resolves.
 */
function mapResponseKindToCapsuleStatus(
  response: HttpResponseV1
): RunCapsuleStatus {
  if (response.kind === 'timeout') return 'timeout';
  if (response.kind === 'success') return 'success';
  // client-error / server-error / network-error / cors-error /
  // too-large all surface as 'error' from the capsule's POV — the
  // raw HTTP status (e.g. 404 vs 500) is still on the wrapped
  // response payload for any consumer that wants to dispatch on it.
  return 'error';
}

/**
 * Serialize the request into a deterministic string suitable for
 * `source.content`. The format mirrors a verbose curl invocation
 * (one line per directive) so a human reading the capsule can
 * reconstruct the request without parsing JSON.
 *
 * **Privacy gate** — sensitive header VALUES are redacted at this
 * boundary. Response-header redaction protects persisted responses;
 * this second layer keeps request header values out of every downstream
 * capsule consumer (share-links, CLI replay, AI prompt inclusion).
 * Names round-trip; values for sensitive headers are replaced with
 * the literal `<redacted>` sentinel.
 *
 * RL-097 Slice 3b — headers are composed via `composeRequestHeaders`, so
 * the INJECTED Auth header (Authorization / API-key from the Auth sub-tab)
 * is reflected in the capsule exactly as it is on the wire — matching the
 * Copy-as-cURL builder. Defense in depth: when an environment is active
 * the caller already passed a `maskSecretsForCapsule`-masked request, so a
 * secret auth `{{token}}` is still a placeholder here; the injected
 * `Authorization` value is ADDITIONALLY redacted to `<redacted>` because
 * `Authorization` / `x-api-key` are baseline-sensitive. A resolved auth
 * secret can therefore never reach the capsule by either path.
 *
 * Headers are sorted lexicographically for content-hash stability:
 * two semantically-identical requests with different ordering must
 * produce the same hash.
 */
function serializeRequestForCapsule(
  request: HttpRequestV1,
  userSensitiveHeaders: readonly string[]
): string {
  const lines: string[] = [];
  lines.push(`# Lingua HTTP request capsule v1`);
  lines.push(`${request.method} ${request.url}`);
  // `composeRequestHeaders` drops disabled / empty rows and appends the
  // injected auth header (auth wins a name collision), matching the wire
  // request the cURL builder prints.
  //
  // The auth-injected header is redacted UNCONDITIONALLY: a custom
  // apiKey header name is not in the baseline sensitive list, so
  // `isHeaderSensitive` alone would let its value through into the
  // shared capsule. Fold it into the per-header check by name.
  const injectedAuthLc = authInjectedHeaderName(request.auth)?.toLowerCase();
  const sortedHeaders = composeRequestHeaders(request)
    .map((h) => ({
      name: h.name,
      value:
        h.name.toLowerCase() === injectedAuthLc ||
        isHeaderSensitive(h.name, userSensitiveHeaders)
          ? '<redacted>'
          : h.value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const h of sortedHeaders) {
    lines.push(`${h.name}: ${h.value}`);
  }
  if (request.body && request.body.kind !== 'none' && request.body.content) {
    lines.push('');
    lines.push(request.body.content);
  }
  return lines.join('\n');
}

export interface BuildHttpResponseCapsuleInput {
  appVersion: string;
  requestName: string;
  request: HttpRequestV1;
  response: HttpResponseV1;
  platform: 'web' | 'desktop';
  /**
   * User's additional sensitive-header allowlist (Settings → Privacy
   * → "Sensitive HTTP headers"). The capsule serializer redacts
   * values for these names alongside the baseline list. Defaults to
   * empty when the caller does not pass anything; the baseline list
   * still applies.
   */
  userSensitiveHeaders?: readonly string[];
}

/**
 * Build a capsule for an HTTP exchange. Delegates the
 * content-hashing + UUID generation + ISO timestamp to the existing
 * `buildRunCapsule` helper so HTTP capsules share every guarantee
 * with code-run capsules.
 */
export async function buildHttpResponseCapsule(
  input: BuildHttpResponseCapsuleInput
): Promise<RunCapsuleV1> {
  const status = mapResponseKindToCapsuleStatus(input.response);
  const content = serializeRequestForCapsule(
    input.request,
    input.userSensitiveHeaders ?? []
  );
  return buildRunCapsule({
    appVersion: input.appVersion,
    tab: {
      name: input.requestName.length > 0 ? input.requestName : 'HTTP request',
      language: 'http',
      runtimeMode: 'http-client',
      workflowMode: 'run',
    },
    source: { content },
    result: {
      status,
      durationMs: Math.max(0, input.response.durationMs),
      // Body and error message ride the existing stdout/stderr slots
      // so the consumer's existing redactor + truncator apply.
      ...(input.response.body.length > 0 ? { stdout: input.response.body } : {}),
      ...(input.response.errorMessage !== undefined
        ? { stderr: input.response.errorMessage }
        : {}),
    },
    environment: {
      platform: input.platform,
      runner: 'http-client',
    },
  });
}

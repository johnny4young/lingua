/**
 * RL-097 Slice 1 — HTTP request workspace schema.
 *
 * Two versioned shapes:
 *
 *   - `HttpRequestV1` — user-editable request: method, URL, headers,
 *     body. Persisted in `workspaceToolStore` and serialised into the
 *     URL fragment of share-links (RL-036) when the user shares an
 *     HTTP response capsule.
 *   - `HttpResponseV1` — the response payload after a request runs.
 *     Wrapped into a `RunCapsuleV1` via `httpResponseCapsule.ts` so
 *     the share / CLI / AI surfaces inherit the existing capsule
 *     redaction + size discipline.
 *
 * Both shapes are pure data — no side effects, no IPC. The runtime
 * layer at `src/renderer/runtime/httpClient.ts` consumes the request
 * and produces the response.
 *
 * Privacy posture:
 *
 *   - Header redaction happens at WRITE time, not at READ time. The
 *     persisted store already holds redacted entries (sensitive
 *     headers were never written to disk in plain). The `executeHttpRequest`
 *     function reads the original headers from the in-memory request
 *     ONCE to send the request, then immediately produces a redacted
 *     `HttpResponseV1`.
 *   - The `redactedHeaders` array on the response lists names (not
 *     values) so the UI can surface "N headers redacted" without
 *     revealing what they were.
 *   - Size caps prevent both DoS and storage exhaustion: 1 MiB on
 *     request body, 4 MiB on response body.
 */

/**
 * Closed enum of HTTP methods Slice 1 supports. CONNECT and TRACE
 * are deliberately excluded — CONNECT is a proxy primitive (browser
 * fetch rejects it anyway) and TRACE is rarely used in modern APIs.
 *
 * Mirrored on `update-server/src/telemetry.ts` as `HTTP_METHODS`
 * with a parity test.
 */
export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Closed enum for the `statusBucket` property on the
 * `http.request_executed` telemetry event. Buckets the integer status
 * code into a coarse-grained class so dashboards group by intent
 * (success / client-error / server-error) without leaking the raw
 * status. `'network-error'` / `'timeout'` / `'cors-error'` cover
 * the typed runtime failures.
 *
 * Mirrored on `update-server/src/telemetry.ts` with a parity test.
 */
export const HTTP_STATUS_BUCKETS = [
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  'network-error',
  'timeout',
  'cors-error',
] as const;
export type HttpStatusBucket = (typeof HTTP_STATUS_BUCKETS)[number];

/**
 * Map a numeric HTTP status into the closed-enum bucket. Anything
 * outside `100..599` falls through to `'5xx'` (defensive — should
 * never happen for a real fetch response).
 */
export function bucketHttpStatus(status: number): HttpStatusBucket {
  if (!Number.isFinite(status)) return '5xx';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  return '5xx';
}

/**
 * Baseline sensitive header names that are ALWAYS redacted regardless
 * of the user's Settings allowlist. The list is short by design —
 * the Settings → Privacy → "Sensitive HTTP headers" editor lets
 * users ADD names, but cannot REMOVE these baselines.
 *
 * Comparison is case-insensitive per RFC 7230 § 3.2 ("Each header
 * field consists of a case-insensitive field name…").
 */
export const BASELINE_SENSITIVE_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];

/** Hard cap on the request body size. 1 MiB. */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

/** Hard cap on the response body size. 4 MiB. */
export const MAX_RESPONSE_BODY_BYTES = 4 * 1_048_576;

/** Default request timeout. User can override per request, capped at 5 min. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** UTF-8 byte count helper for caps that are documented in bytes, not JS code units. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * One header on a request. `enabled: false` means the row is
 * presented in the UI but excluded from the actual send — lets users
 * "comment out" a header without deleting it.
 */
export interface HttpRequestHeader {
  name: string;
  value: string;
  enabled: boolean;
}

/**
 * Body discriminator. `'none'` is the GET / HEAD default. JSON / text /
 * form get their own kind so the UI can pick the right editor + the
 * runtime can set Content-Type correctly.
 *
 * `form` content is a serialized `application/x-www-form-urlencoded`
 * string — the UI may surface it as key-value rows but it's stored as
 * the wire format to keep the schema flat.
 */
export type HttpRequestBodyKind = 'none' | 'json' | 'text' | 'form';

export interface HttpRequestBody {
  kind: HttpRequestBodyKind;
  /** Required for non-`'none'` kinds. Capped at `MAX_REQUEST_BODY_BYTES`. */
  content?: string;
}

/**
 * One URL query parameter row in the request builder's Params sub-tab.
 * Mirrors the header-row shape (`enabled: false` "comments out" the
 * row). The Params table is kept in two-way sync with the URL query
 * string by the editor (`paramsToUrl` / `urlToParams`).
 */
export interface HttpQueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * Where a capture rule reads its value from on a successful response:
 *   - `body-json` — parse the body as JSON and walk `path`
 *     (`data.token`, `items[0].id`).
 *   - `header` — case-insensitive lookup of the response header named
 *     by `path`.
 *   - `status` — the numeric HTTP status (path is ignored).
 */
export type HttpCaptureSource = 'body-json' | 'header' | 'status';

/**
 * A post-response capture: after a request succeeds, read a value out
 * of the response and write it into the active environment variable
 * `targetVariable`. This is what turns the workspace into a real
 * request-chaining client (login → token → authenticated call). Rules
 * live on the request so they persist and export with it.
 */
export interface HttpCaptureRule {
  /** Opaque client-side row id (React key + drag handle). */
  id: string;
  source: HttpCaptureSource;
  /**
   * The extraction path. A JSON path for `body-json`, a header name
   * for `header`, ignored for `status`. May be empty on a blank row.
   */
  path: string;
  /** Environment variable key the extracted value is written to. */
  targetVariable: string;
  /** Disabled rows are inert (kept for quick toggling). */
  enabled: boolean;
}

/**
 * Closed enum of auth schemes the Auth sub-tab supports. `'none'` is
 * the default (no header injected). Each non-none scheme injects a
 * single header on send:
 *
 *   - `'bearer'` → `Authorization: Bearer <token>`
 *   - `'basic'`  → `Authorization: Basic base64(user:pass)`
 *   - `'apiKey'` → a custom header named by `apiKeyHeader`, value
 *     `apiKeyValue` (defaults to `X-API-Key`).
 *
 * The injected header is ALWAYS baseline-sensitive (`Authorization`
 * and `x-api-key` are in `BASELINE_SENSITIVE_HEADERS`), so the
 * existing response-side + capsule redaction covers it. The auth
 * config itself (token / password) is persisted in plain in the
 * request store the same way an explicit `Authorization` header row
 * already is — redaction is a TELEMETRY / SHARE-time guarantee, not a
 * local-storage-at-rest one (see the file header).
 */
export type HttpAuthKind = 'none' | 'bearer' | 'basic' | 'apiKey';

export interface HttpRequestAuth {
  kind: HttpAuthKind;
  /** Bearer token. Used only when `kind === 'bearer'`. */
  token?: string;
  /** Basic auth username. Used only when `kind === 'basic'`. */
  username?: string;
  /** Basic auth password. Used only when `kind === 'basic'`. */
  password?: string;
  /** API key header name (defaults to `X-API-Key`). `kind === 'apiKey'`. */
  apiKeyHeader?: string;
  /** API key header value. `kind === 'apiKey'`. */
  apiKeyValue?: string;
}

export interface HttpRequestV1 {
  /** Hard-coded `1`. `parseHttpRequest` rejects any other value. */
  version: 1;
  /** UUIDv4 from `crypto.randomUUID()`. */
  id: string;
  /** User-editable label shown in the request list. */
  name: string;
  method: HttpMethod;
  /** URL string. The runtime validates with `new URL()` before sending. */
  url: string;
  headers: HttpRequestHeader[];
  /**
   * Optional URL query parameters editable in the Params sub-tab. Kept
   * in two-way sync with the query string of `url` by the editor.
   * Optional + back-compat: requests persisted before this field
   * existed (and the runtime) treat its absence as "params live
   * entirely in the URL string". When present, `enabled` rows are the
   * source of truth that produced the current `url`.
   */
  queryParams?: HttpQueryParam[];
  /**
   * Optional auth config injected as a header on send. Absent / `'none'`
   * means no injection. Back-compat: old persisted requests load with
   * no auth.
   */
  auth?: HttpRequestAuth;
  body?: HttpRequestBody;
  /**
   * Optional post-response capture rules (request chaining). Absent /
   * empty means no capture. Back-compat: requests persisted before this
   * field existed load with no captures.
   */
  captures?: HttpCaptureRule[];
  /** Optional per-request timeout override. Capped at `MAX_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** ISO timestamp (millisecond precision). */
  createdAt: string;
  updatedAt: string;
}

/**
 * Closed enum for the response outcome bucket. Distinct from
 * `HttpStatusBucket` — this is the renderer-facing failure
 * classification the UI uses to switch error copy.
 */
export type HttpResponseKind =
  | 'success'
  | 'client-error'
  | 'server-error'
  | 'network-error'
  | 'timeout'
  | 'cors-error'
  | 'too-large';

export interface HttpResponseHeader {
  name: string;
  value: string;
  redacted: boolean;
}

export interface HttpResponseV1 {
  /** Hard-coded `1`. `parseHttpResponse` rejects any other value. */
  version: 1;
  /** Closed-enum outcome. */
  kind: HttpResponseKind;
  /**
   * Numeric HTTP status. `0` for `'network-error'` / `'cors-error'` /
   * `'timeout'` (no response was received).
   */
  status: number;
  statusText: string;
  /** Original URL the request targeted. */
  url: string;
  /** Resolved URL after redirects. Equals `url` when no redirect occurred. */
  finalUrl: string;
  headers: HttpResponseHeader[];
  /**
   * Response body capped at `MAX_RESPONSE_BODY_BYTES`. May be empty
   * for HEAD requests or `'too-large'` responses (the `tooLarge`
   * flag distinguishes).
   */
  body: string;
  /** Sniffed content-type. Empty string when the server did not send one. */
  contentType: string;
  /** Response payload byte length BEFORE the cap. */
  sizeBytes: number;
  /** Wall-clock duration from send to settle, in milliseconds. */
  durationMs: number;
  /** Set when the body hit `MAX_RESPONSE_BODY_BYTES`. */
  tooLarge: boolean;
  /** Names (lowercased) of headers that were redacted on this response. */
  redactedHeaders: string[];
  /** ISO timestamp the response was recorded. */
  recordedAt: string;
  /**
   * Diagnostic message for the failure kinds (`'network-error'`,
   * `'timeout'`, `'cors-error'`). Absent on success / client-error /
   * server-error (where the status code carries the signal).
   */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Parsers — defense in depth at the localStorage rehydrate boundary.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHttpMethod(value: unknown): value is HttpMethod {
  return (
    typeof value === 'string' && (HTTP_METHODS as readonly string[]).includes(value)
  );
}

function isHttpRequestBodyKind(value: unknown): value is HttpRequestBodyKind {
  return (
    value === 'none' || value === 'json' || value === 'text' || value === 'form'
  );
}

function parseHeaderEntry(value: unknown): HttpRequestHeader | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  const headerValue = value.value;
  const enabled = value.enabled;
  if (typeof name !== 'string') return null;
  if (typeof headerValue !== 'string') return null;
  if (typeof enabled !== 'boolean') return null;
  // Trim leading/trailing whitespace on names per RFC 7230; values
  // are preserved verbatim (some APIs accept leading spaces in values).
  // Empty names are valid drafts in the editor and are skipped at send time.
  return { name: name.trim(), value: headerValue, enabled };
}

/**
 * Parse one query-param row. Same null-on-mismatch discipline as the
 * header parser. `key` may be empty (a draft row in the editor); empty
 * keys are skipped at URL-build time.
 */
function parseQueryParamEntry(value: unknown): HttpQueryParam | null {
  if (!isRecord(value)) return null;
  const key = value.key;
  const paramValue = value.value;
  const enabled = value.enabled;
  if (typeof key !== 'string') return null;
  if (typeof paramValue !== 'string') return null;
  if (typeof enabled !== 'boolean') return null;
  return { key, value: paramValue, enabled };
}

function isCaptureSource(value: unknown): value is HttpCaptureSource {
  return value === 'body-json' || value === 'header' || value === 'status';
}

function parseCaptureRuleEntry(value: unknown): HttpCaptureRule | null {
  if (!isRecord(value)) return null;
  const { id, source, path, targetVariable, enabled } = value;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!isCaptureSource(source)) return null;
  if (typeof path !== 'string') return null;
  if (typeof targetVariable !== 'string') return null;
  if (typeof enabled !== 'boolean') return null;
  return { id, source, path, targetVariable, enabled };
}

function isHttpAuthKind(value: unknown): value is HttpAuthKind {
  return (
    value === 'none' ||
    value === 'bearer' ||
    value === 'basic' ||
    value === 'apiKey'
  );
}

/**
 * Parse the optional auth block. Returns `null` ONLY on a structural
 * mismatch (caller distinguishes "absent" from "invalid"). Unknown
 * fields for the active kind are tolerated — we read only the fields
 * the kind needs at send time, so a `basic` block carrying a stale
 * `token` is harmless.
 */
function parseAuth(value: unknown): HttpRequestAuth | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  if (!isHttpAuthKind(value.kind)) return null;
  const auth: HttpRequestAuth = { kind: value.kind };
  if (typeof value.token === 'string') auth.token = value.token;
  if (typeof value.username === 'string') auth.username = value.username;
  if (typeof value.password === 'string') auth.password = value.password;
  if (typeof value.apiKeyHeader === 'string') auth.apiKeyHeader = value.apiKeyHeader;
  if (typeof value.apiKeyValue === 'string') auth.apiKeyValue = value.apiKeyValue;
  return auth;
}

function parseBody(value: unknown): HttpRequestBody | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  if (!isHttpRequestBodyKind(value.kind)) return null;
  if (value.kind === 'none') return { kind: 'none' };
  const content = value.content;
  if (typeof content !== 'string') return null;
  if (utf8ByteLength(content) > MAX_REQUEST_BODY_BYTES) return null;
  return { kind: value.kind, content };
}

/**
 * Strict parser for a persisted request. Returns `null` on ANY
 * shape mismatch so the rehydrate path drops invalid entries
 * silently — better an empty list than a corrupt one that crashes
 * the panel on every render.
 */
export function parseHttpRequest(value: unknown): HttpRequestV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.name !== 'string') return null;
  if (!isHttpMethod(value.method)) return null;
  // URL can be empty on a blank-template request (the runtime
  // validates with `new URL()` before sending). Only reject the
  // non-string case here.
  if (typeof value.url !== 'string') return null;
  if (!Array.isArray(value.headers)) return null;
  const headers: HttpRequestHeader[] = [];
  for (const raw of value.headers) {
    const parsed = parseHeaderEntry(raw);
    if (parsed === null) return null;
    headers.push(parsed);
  }
  // Back-compat: `queryParams` is optional. Absent → undefined (params
  // live in the URL string). Present-but-not-an-array → reject the
  // whole entry (corrupt). Present array → drop only the invalid rows.
  let queryParams: HttpQueryParam[] | undefined;
  if (value.queryParams !== undefined) {
    if (!Array.isArray(value.queryParams)) return null;
    const parsedParams: HttpQueryParam[] = [];
    for (const raw of value.queryParams) {
      const parsed = parseQueryParamEntry(raw);
      if (parsed === null) return null;
      parsedParams.push(parsed);
    }
    queryParams = parsedParams;
  }
  // Back-compat: `auth` is optional. Absent → undefined (no injection).
  // Present-but-invalid → reject the whole entry.
  let auth: HttpRequestAuth | undefined;
  if (value.auth !== undefined) {
    const parsedAuth = parseAuth(value.auth);
    if (parsedAuth === null) return null;
    auth = parsedAuth;
  }
  const body = parseBody(value.body);
  if (value.body !== undefined && body === null) return null;
  // Back-compat: `captures` is optional. Present-but-not-an-array →
  // reject the entry; present array → drop only the invalid rows.
  let captures: HttpCaptureRule[] | undefined;
  if (value.captures !== undefined) {
    if (!Array.isArray(value.captures)) return null;
    const parsedCaptures: HttpCaptureRule[] = [];
    for (const raw of value.captures) {
      const parsed = parseCaptureRuleEntry(raw);
      if (parsed === null) return null;
      parsedCaptures.push(parsed);
    }
    captures = parsedCaptures;
  }
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (typeof createdAt !== 'string') return null;
  if (typeof updatedAt !== 'string') return null;
  let timeoutMs: number | undefined;
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number') return null;
    if (!Number.isFinite(value.timeoutMs)) return null;
    if (value.timeoutMs <= 0) return null;
    timeoutMs = Math.min(value.timeoutMs, MAX_REQUEST_TIMEOUT_MS);
  }
  return {
    version: 1,
    id: value.id,
    name: value.name,
    method: value.method,
    url: value.url,
    headers,
    ...(queryParams !== undefined ? { queryParams } : {}),
    ...(auth !== undefined ? { auth } : {}),
    ...(body ? { body } : {}),
    ...(captures !== undefined ? { captures } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    createdAt,
    updatedAt,
  };
}

function parseResponseHeader(value: unknown): HttpResponseHeader | null {
  if (!isRecord(value)) return null;
  const name = value.name;
  const headerValue = value.value;
  const redacted = value.redacted;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof headerValue !== 'string') return null;
  if (typeof redacted !== 'boolean') return null;
  return { name, value: headerValue, redacted };
}

/**
 * Strict parser for a persisted response. Same null-on-mismatch
 * discipline as `parseHttpRequest`.
 */
export function parseHttpResponse(value: unknown): HttpResponseV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (
    value.kind !== 'success' &&
    value.kind !== 'client-error' &&
    value.kind !== 'server-error' &&
    value.kind !== 'network-error' &&
    value.kind !== 'timeout' &&
    value.kind !== 'cors-error' &&
    value.kind !== 'too-large'
  ) {
    return null;
  }
  if (typeof value.status !== 'number' || !Number.isFinite(value.status)) {
    return null;
  }
  if (typeof value.statusText !== 'string') return null;
  if (typeof value.url !== 'string') return null;
  if (typeof value.finalUrl !== 'string') return null;
  if (!Array.isArray(value.headers)) return null;
  const headers: HttpResponseHeader[] = [];
  for (const raw of value.headers) {
    const parsed = parseResponseHeader(raw);
    if (parsed === null) return null;
    headers.push(parsed);
  }
  if (typeof value.body !== 'string') return null;
  if (utf8ByteLength(value.body) > MAX_RESPONSE_BODY_BYTES) return null;
  if (typeof value.contentType !== 'string') return null;
  if (
    typeof value.sizeBytes !== 'number' ||
    !Number.isFinite(value.sizeBytes) ||
    value.sizeBytes < 0
  ) {
    return null;
  }
  if (
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    return null;
  }
  if (typeof value.tooLarge !== 'boolean') return null;
  if (!Array.isArray(value.redactedHeaders)) return null;
  const redactedHeaders: string[] = [];
  for (const entry of value.redactedHeaders) {
    if (typeof entry !== 'string') return null;
    redactedHeaders.push(entry);
  }
  if (typeof value.recordedAt !== 'string') return null;
  let errorMessage: string | undefined;
  if (value.errorMessage !== undefined) {
    if (typeof value.errorMessage !== 'string') return null;
    errorMessage = value.errorMessage;
  }
  return {
    version: 1,
    kind: value.kind,
    status: value.status,
    statusText: value.statusText,
    url: value.url,
    finalUrl: value.finalUrl,
    headers,
    body: value.body,
    contentType: value.contentType,
    sizeBytes: value.sizeBytes,
    durationMs: value.durationMs,
    tooLarge: value.tooLarge,
    redactedHeaders,
    recordedAt: value.recordedAt,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

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
  if ((BASELINE_SENSITIVE_HEADERS as readonly string[]).includes(lc)) {
    return true;
  }
  for (const allow of userAllowlist) {
    if (typeof allow !== 'string') continue;
    if (allow.toLowerCase().trim() === lc) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Params <-> URL sync. The Params sub-tab and the URL bar are two views
// of the same query string; these helpers keep them coherent.
// ---------------------------------------------------------------------------

/**
 * Split a URL string into its base (everything before `?`) and its
 * raw query string (everything after the first `?`, sans the `?`
 * itself, and dropping any `#fragment`). Works on partial / invalid
 * URLs too — the editor lets the user type `api.exa` before it parses
 * — so we operate on the raw string, never `new URL()`.
 */
function splitUrlQuery(url: string): { base: string; query: string } {
  const hashIdx = url.indexOf('#');
  const withoutHash = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const qIdx = withoutHash.indexOf('?');
  if (qIdx === -1) return { base: withoutHash, query: '' };
  return {
    base: withoutHash.slice(0, qIdx),
    query: withoutHash.slice(qIdx + 1),
  };
}

/**
 * Derive query-param rows from a URL string. Used to seed the Params
 * table from a URL the user typed / pasted (or a back-compat request
 * with no `queryParams`). Decodes `+` and percent-escapes per
 * `URLSearchParams`. Every derived row is `enabled: true`.
 */
export function urlToParams(url: string): HttpQueryParam[] {
  const { query } = splitUrlQuery(url);
  if (query.length === 0) return [];
  const params: HttpQueryParam[] = [];
  // `URLSearchParams` handles `+` → space, percent-decoding, and
  // repeated keys (each becomes its own row, preserving order).
  for (const [key, value] of new URLSearchParams(query)) {
    params.push({ key, value, enabled: true });
  }
  return params;
}

/**
 * Reconcile the Params table when the URL bar is edited directly.
 *
 * `urlToParams` alone only recovers the `enabled` rows encoded in the
 * query string — a disabled ("commented out") row is intentionally NOT
 * in the URL (`paramsToUrl` drops it), so re-seeding purely from the URL
 * silently DELETES every disabled row on the first keystroke. This
 * merges the freshly-parsed enabled rows with the disabled rows carried
 * over from `prevParams`, so toggling a row off and then editing the URL
 * no longer loses it. Disabled rows keep their relative order and are
 * appended after the URL-derived rows.
 */
export function reconcileParamsWithUrl(
  nextUrl: string,
  prevParams: ReadonlyArray<HttpQueryParam>
): HttpQueryParam[] {
  const fromUrl = urlToParams(nextUrl);
  const disabled = prevParams.filter((param) => !param.enabled);
  return [...fromUrl, ...disabled];
}

/**
 * Rebuild a URL string from a base URL + query-param rows. The base is
 * taken from `url` (everything before `?`); enabled rows with a
 * non-empty key are appended as a fresh query string. Disabled rows
 * and empty-key rows are dropped. A trailing `#fragment` on the input
 * is preserved. Encoding matches `URLSearchParams` (so it round-trips
 * with `urlToParams`).
 */
export function paramsToUrl(url: string, params: ReadonlyArray<HttpQueryParam>): string {
  const hashIdx = url.indexOf('#');
  const fragment = hashIdx === -1 ? '' : url.slice(hashIdx);
  const { base } = splitUrlQuery(url);
  const search = new URLSearchParams();
  for (const param of params) {
    if (!param.enabled) continue;
    if (param.key.length === 0) continue;
    search.append(param.key, param.value);
  }
  const query = search.toString();
  return query.length > 0 ? `${base}?${query}${fragment}` : `${base}${fragment}`;
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
// Post-response capture (request chaining). Pure extraction of a value
// from a response per a capture rule, plus a blank-rule factory.
// ---------------------------------------------------------------------------

/** A fresh, disabled-by-nothing capture rule for the Capture tab. */
export function createBlankCaptureRule(): HttpCaptureRule {
  return {
    id: crypto.randomUUID(),
    source: 'body-json',
    path: '',
    targetVariable: '',
    enabled: true,
  };
}

/**
 * Walk a JSON body by a dot/bracket path (`data.token`, `items[0].id`,
 * `items.0.id` — both index forms accepted). Returns the value as a
 * string when it resolves to a JSON primitive; `null` when the body is
 * not JSON, the path misses, or the value is an object/array (a variable
 * can only hold a string).
 */
function extractJsonPath(body: string, rawPath: string): string | null {
  let current: unknown;
  try {
    current = JSON.parse(body);
  } catch {
    return null;
  }
  const keys = rawPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0) return null;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (current === null || current === undefined) return null;
  if (typeof current === 'object') return null;
  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  return null;
}

/**
 * Resolve a single capture rule against a response. `null` when the
 * rule can't produce a value (miss, non-JSON body, no such header).
 * Pure — the caller decides whether/where to write the value.
 */
export function extractCaptureValue(
  response: HttpResponseV1,
  rule: HttpCaptureRule
): string | null {
  switch (rule.source) {
    case 'status':
      return String(response.status);
    case 'header': {
      const target = rule.path.trim().toLowerCase();
      if (target.length === 0) return null;
      const match = response.headers.find(
        (header) => header.name.toLowerCase() === target
      );
      return match ? match.value : null;
    }
    case 'body-json':
      return extractJsonPath(response.body, rule.path);
    default:
      return null;
  }
}

/**
 * Resolve every enabled rule with a non-empty target that produced a
 * value. The result is the list of `{ targetVariable, value }` writes
 * the panel applies to the active environment. Rules that miss or that
 * lack a target are silently skipped (the panel surfaces a summary).
 */
export function applyCaptureRules(
  response: HttpResponseV1,
  rules: ReadonlyArray<HttpCaptureRule>
): Array<{ targetVariable: string; value: string }> {
  const writes: Array<{ targetVariable: string; value: string }> = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const target = rule.targetVariable.trim();
    if (target.length === 0) continue;
    const value = extractCaptureValue(response, rule);
    if (value === null) continue;
    writes.push({ targetVariable: target, value });
  }
  return writes;
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
 * RL-097 Slice 3a fold B — ENVIRONMENT SECRET EXCEPTION. The
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

/**
 * Helper: build a fresh `HttpRequestV1` with sensible defaults. Used
 * by the "New request" affordance in the UI.
 */
export function createBlankHttpRequest(options: {
  id: string;
  name?: string;
  now?: string;
}): HttpRequestV1 {
  const now = options.now ?? new Date().toISOString();
  return {
    version: 1,
    id: options.id,
    name: options.name ?? '',
    method: 'GET',
    url: '',
    headers: [],
    createdAt: now,
    updatedAt: now,
  };
}

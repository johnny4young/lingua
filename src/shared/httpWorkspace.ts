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
  body?: HttpRequestBody;
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
  const body = parseBody(value.body);
  if (value.body !== undefined && body === null) return null;
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
    ...(body ? { body } : {}),
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

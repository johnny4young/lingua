/**
 * Dependency-safe HTTP workspace schema and request factory.
 *
 * Import Preview and other lightweight request-building surfaces may use this
 * module without loading the full parser, auth, capture, assertion, and cURL
 * serialization implementation in `httpWorkspace.ts`.
 *
 * Keep this file pure and dependency-free. Runtime validation and behavioral
 * helpers belong in `httpWorkspace.ts` on the activated workspace side.
 */

/**
 * Closed enum of HTTP methods Lingua supports. CONNECT and TRACE
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
 * internal — where a response assertion reads its actual value from. The
 * first three mirror `HttpCaptureSource` (and reuse the same extractor);
 * `response-time` checks the round-trip duration in milliseconds.
 */
export type HttpAssertionSource =
  | 'status'
  | 'header'
  | 'body-json'
  | 'response-time';

/**
 * How an assertion compares the actual value to `expected`.
 *   - `equals` / `not-equals` — string-equality (numbers compared as
 *     strings, so `status equals 200`).
 *   - `contains` — substring of the actual value.
 *   - `exists` / `not-exists` — the source produced a value at all
 *     (`expected` is ignored; e.g. "header x-request-id exists").
 *   - `less-than` / `greater-than` — numeric compare (for
 *     `response-time` or a numeric body/status value).
 */
export type HttpAssertionComparator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'exists'
  | 'not-exists'
  | 'less-than'
  | 'greater-than';

/**
 * A post-response assertion. After a request settles, each enabled
 * assertion reads a value from the response (status, a header, a JSON
 * body path, or the round-trip time) and checks it against `expected`
 * with `comparator`. Assertions live on the request so they persist and
 * export with it — the "Postman-style tests" surface without the cloud.
 */
export interface HttpAssertion {
  /** Opaque client-side row id (React key + drag handle). */
  id: string;
  source: HttpAssertionSource;
  /**
   * The extraction path: a JSON path for `body-json`, a header name for
   * `header`, ignored for `status` / `response-time`.
   */
  path: string;
  comparator: HttpAssertionComparator;
  /** The expected value. Ignored for `exists` / `not-exists`. */
  expected: string;
  /** Disabled rows are inert (kept for quick toggling). */
  enabled: boolean;
}

/** The outcome of evaluating one assertion against a response. */
export interface HttpAssertionResult {
  readonly id: string;
  readonly pass: boolean;
  /** The value the source produced, or null when it missed. */
  readonly actual: string | null;
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
  /**
   * internal — optional post-response assertions (Postman-style tests).
   * Absent / empty means no assertions. Back-compat: requests persisted
   * before this field existed load with no assertions.
   */
  assertions?: HttpAssertion[];
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

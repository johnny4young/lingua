/**
 * Persistence validation for the HTTP workspace.
 *
 * This module owns the strict parsers used at localStorage and IPC trust
 * boundaries. It depends only on `httpWorkspaceSchema.ts`, so persistence
 * consumers do not activate header composition, query synchronization,
 * captures, assertions, or cURL serialization from their dedicated leaves.
 */

import {
  HTTP_METHODS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
  utf8ByteLength,
} from './httpWorkspaceSchema';
import type {
  HttpAssertion,
  HttpAssertionComparator,
  HttpAssertionSource,
  HttpAuthKind,
  HttpCaptureRule,
  HttpCaptureSource,
  HttpMethod,
  HttpQueryParam,
  HttpRequestAuth,
  HttpRequestBody,
  HttpRequestBodyKind,
  HttpRequestHeader,
  HttpRequestV1,
  HttpResponseHeader,
  HttpResponseV1,
} from './httpWorkspaceSchema';

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

function isAssertionSource(value: unknown): value is HttpAssertionSource {
  return (
    value === 'status' ||
    value === 'header' ||
    value === 'body-json' ||
    value === 'response-time'
  );
}

function isAssertionComparator(value: unknown): value is HttpAssertionComparator {
  return (
    value === 'equals' ||
    value === 'not-equals' ||
    value === 'contains' ||
    value === 'exists' ||
    value === 'not-exists' ||
    value === 'less-than' ||
    value === 'greater-than'
  );
}

function parseAssertionEntry(value: unknown): HttpAssertion | null {
  if (!isRecord(value)) return null;
  const { id, source, path, comparator, expected, enabled } = value;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!isAssertionSource(source)) return null;
  if (typeof path !== 'string') return null;
  if (!isAssertionComparator(comparator)) return null;
  if (typeof expected !== 'string') return null;
  if (typeof enabled !== 'boolean') return null;
  return { id, source, path, comparator, expected, enabled };
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
  // Back-compat: `assertions` is optional. Present-but-not-an-array →
  // reject the entry; present array → every row must be valid.
  let assertions: HttpAssertion[] | undefined;
  if (value.assertions !== undefined) {
    if (!Array.isArray(value.assertions)) return null;
    const parsedAssertions: HttpAssertion[] = [];
    for (const raw of value.assertions) {
      const parsed = parseAssertionEntry(raw);
      if (parsed === null) return null;
      parsedAssertions.push(parsed);
    }
    assertions = parsedAssertions;
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
    ...(assertions !== undefined ? { assertions } : {}),
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

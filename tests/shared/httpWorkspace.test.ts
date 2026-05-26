/**
 * RL-097 Slice 1 — Schema + validators for `HttpRequestV1` /
 * `HttpResponseV1` + header-sensitivity helper.
 *
 * Pinned coverage:
 *   - Parser rejects every shape mismatch (version, missing fields,
 *     wrong types, out-of-range timeouts).
 *   - Parser accepts a minimal valid request + a full request.
 *   - `bucketHttpStatus` maps integer status codes to the closed
 *     enum.
 *   - `isHeaderSensitive` is case-insensitive EXACT match (does NOT
 *     substring-match `Document-Authorization-Date`).
 *   - `createBlankHttpRequest` produces a parseable shape.
 */

import { describe, expect, it } from 'vitest';
import {
  BASELINE_SENSITIVE_HEADERS,
  bucketHttpStatus,
  createBlankHttpRequest,
  HTTP_METHODS,
  HTTP_STATUS_BUCKETS,
  isHeaderSensitive,
  parseHttpRequest,
  parseHttpResponse,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BODY_BYTES,
} from '../../src/shared/httpWorkspace';

describe('HTTP_METHODS / HTTP_STATUS_BUCKETS closed enums', () => {
  it('exposes the seven Slice 1 methods', () => {
    expect([...HTTP_METHODS]).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ]);
  });

  it('exposes the seven status buckets including typed failures', () => {
    expect([...HTTP_STATUS_BUCKETS]).toEqual([
      '2xx',
      '3xx',
      '4xx',
      '5xx',
      'network-error',
      'timeout',
      'cors-error',
    ]);
  });
});

describe('bucketHttpStatus', () => {
  it('maps standard ranges', () => {
    expect(bucketHttpStatus(200)).toBe('2xx');
    expect(bucketHttpStatus(204)).toBe('2xx');
    expect(bucketHttpStatus(301)).toBe('3xx');
    expect(bucketHttpStatus(404)).toBe('4xx');
    expect(bucketHttpStatus(500)).toBe('5xx');
    expect(bucketHttpStatus(599)).toBe('5xx');
  });

  it('falls back to 5xx for malformed input', () => {
    expect(bucketHttpStatus(Number.NaN)).toBe('5xx');
    expect(bucketHttpStatus(0)).toBe('5xx');
    expect(bucketHttpStatus(-1)).toBe('5xx');
  });
});

describe('isHeaderSensitive', () => {
  it('redacts baseline names case-insensitively', () => {
    expect(isHeaderSensitive('Authorization', [])).toBe(true);
    expect(isHeaderSensitive('authorization', [])).toBe(true);
    expect(isHeaderSensitive('AUTHORIZATION', [])).toBe(true);
    expect(isHeaderSensitive('Cookie', [])).toBe(true);
  });

  it('redacts user-added names case-insensitively', () => {
    expect(isHeaderSensitive('X-Custom-Token', ['x-custom-token'])).toBe(true);
    expect(isHeaderSensitive('X-Custom-Token', ['X-Custom-Token'])).toBe(true);
  });

  it('does NOT substring-match — `Document-Authorization-Date` is not redacted', () => {
    expect(isHeaderSensitive('Document-Authorization-Date', [])).toBe(false);
    expect(isHeaderSensitive('My-Cookie-Jar', [])).toBe(false);
  });

  it('safe-handles malformed input', () => {
    expect(isHeaderSensitive('', [])).toBe(false);
    expect(
      isHeaderSensitive('Authorization', [
        // non-string in the allowlist
        // @ts-expect-error — testing defensive coercion
        123,
      ])
    ).toBe(true);
  });
});

describe('parseHttpRequest', () => {
  const minimal = {
    version: 1 as const,
    id: 'uuid-1',
    name: '',
    method: 'GET' as const,
    url: 'https://example.com/',
    headers: [],
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  };

  it('accepts a minimal valid request', () => {
    expect(parseHttpRequest(minimal)).toEqual(minimal);
  });

  it('rejects version != 1', () => {
    expect(parseHttpRequest({ ...minimal, version: 2 })).toBeNull();
  });

  it('rejects unknown method', () => {
    expect(parseHttpRequest({ ...minimal, method: 'TRACE' })).toBeNull();
  });

  it('rejects empty id (URL can be empty on a blank template)', () => {
    expect(parseHttpRequest({ ...minimal, id: '' })).toBeNull();
    // Blank URL is accepted — the runtime validates with new URL()
    // at execute time, so a "draft" request with no URL yet round-trips.
    expect(parseHttpRequest({ ...minimal, url: '' })).not.toBeNull();
  });

  it('rejects malformed header rows', () => {
    expect(
      parseHttpRequest({
        ...minimal,
        headers: [{ name: 'X', value: 'y', enabled: 'yes' as unknown }],
      })
    ).toBeNull();
  });

  it('accepts draft header rows with empty names', () => {
    const parsed = parseHttpRequest({
      ...minimal,
      headers: [{ name: '', value: 'y', enabled: true }],
    });

    expect(parsed?.headers).toEqual([{ name: '', value: 'y', enabled: true }]);
  });

  it('caps timeoutMs at MAX_REQUEST_TIMEOUT_MS', () => {
    const big = parseHttpRequest({ ...minimal, timeoutMs: 999_999_999 });
    expect(big?.timeoutMs).toBe(5 * 60 * 1000);
  });

  it('rejects non-numeric / non-positive timeoutMs', () => {
    expect(parseHttpRequest({ ...minimal, timeoutMs: '60' })).toBeNull();
    expect(parseHttpRequest({ ...minimal, timeoutMs: 0 })).toBeNull();
    expect(parseHttpRequest({ ...minimal, timeoutMs: -10 })).toBeNull();
  });

  it('rejects malformed body', () => {
    expect(
      parseHttpRequest({ ...minimal, body: { kind: 'json' } })
    ).toBeNull();
    expect(
      parseHttpRequest({ ...minimal, body: { kind: 'json', content: 123 } })
    ).toBeNull();
    expect(
      parseHttpRequest({ ...minimal, body: { kind: 'invalid', content: 'x' } })
    ).toBeNull();
  });

  it('rejects request bodies over the UTF-8 byte cap', () => {
    const oversized = 'é'.repeat(Math.floor(MAX_REQUEST_BODY_BYTES / 2) + 1);
    expect(
      parseHttpRequest({
        ...minimal,
        method: 'POST',
        body: { kind: 'text', content: oversized },
      })
    ).toBeNull();
  });
});

describe('parseHttpResponse', () => {
  const valid = {
    version: 1 as const,
    kind: 'success' as const,
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    headers: [{ name: 'content-type', value: 'application/json', redacted: false }],
    body: '{"ok":true}',
    contentType: 'application/json',
    sizeBytes: 11,
    durationMs: 42,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
  };

  it('accepts a valid response', () => {
    expect(parseHttpResponse(valid)).toEqual(valid);
  });

  it('rejects unknown kind', () => {
    expect(parseHttpResponse({ ...valid, kind: 'maybe' })).toBeNull();
  });

  it('rejects non-string body', () => {
    expect(parseHttpResponse({ ...valid, body: 123 })).toBeNull();
  });

  it('rejects response bodies over the UTF-8 byte cap', () => {
    const oversized = 'é'.repeat(Math.floor(MAX_RESPONSE_BODY_BYTES / 2) + 1);
    expect(parseHttpResponse({ ...valid, body: oversized })).toBeNull();
  });
});

describe('createBlankHttpRequest', () => {
  it('produces a parseable shape', () => {
    const req = createBlankHttpRequest({
      id: 'uuid-1',
      now: '2026-05-26T00:00:00.000Z',
    });
    expect(parseHttpRequest(req)).toEqual(req);
  });
});

describe('BASELINE_SENSITIVE_HEADERS', () => {
  it('covers Authorization, Cookie, and proxy variants', () => {
    expect(BASELINE_SENSITIVE_HEADERS).toContain('authorization');
    expect(BASELINE_SENSITIVE_HEADERS).toContain('cookie');
    expect(BASELINE_SENSITIVE_HEADERS).toContain('set-cookie');
    expect(BASELINE_SENSITIVE_HEADERS).toContain('x-api-key');
    expect(BASELINE_SENSITIVE_HEADERS).toContain('x-auth-token');
    expect(BASELINE_SENSITIVE_HEADERS).toContain('proxy-authorization');
  });
});

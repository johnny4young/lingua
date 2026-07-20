/**
 * implementation — `httpClient.ts` end-to-end behaviour with a mock
 * `fetch`. Covers the typed failure classification, the body cap,
 * header redaction (baseline + user allowlist), and the URL
 * validation.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  effectiveSensitiveHeaderSet,
  executeHttpRequest,
  statusBucketForResponse,
} from '../../../src/renderer/runtime/httpClient';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
} from '../../../src/shared/httpWorkspace';

function makeRequest(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({
      id: 'r1',
      now: '2026-05-26T00:00:00.000Z',
    }),
    url: 'https://api.example.com/users',
    method: 'GET',
    ...overrides,
  };
}

function mockFetch(response: Partial<Response> & { _body?: string }) {
  return async (): Promise<Response> => {
    const body = response._body ?? '';
    const headers = response.headers ?? new Headers();
    return new Response(body, {
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      headers,
    });
  };
}

describe('executeHttpRequest ', () => {
  it('returns a 2xx success response with parsed headers + body', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      _body: '{"ok":true}',
    });
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    expect(res.kind).toBe('success');
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.contentType).toBe('application/json');
  });

  it('classifies 4xx as client-error', async () => {
    const fetchImpl = mockFetch({ status: 404, statusText: 'Not Found' });
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    expect(res.kind).toBe('client-error');
    expect(res.status).toBe(404);
  });

  it('classifies 5xx as server-error', async () => {
    const fetchImpl = mockFetch({ status: 500, statusText: 'Server Error' });
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    expect(res.kind).toBe('server-error');
  });

  it('classifies a thrown TypeError("Failed to fetch") as network-error', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    expect(res.kind).toBe('network-error');
    expect(res.status).toBe(0);
    expect(res.errorMessage).toMatch(/failed to fetch/i);
  });

  it('classifies a CORS-style error', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError('CORS preflight rejected the request');
    };
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    expect(res.kind).toBe('cors-error');
  });

  it('redacts baseline Authorization header on the response', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      headers: new Headers({
        authorization: 'Bearer secret',
        'set-cookie': 'session=xyz',
        'content-type': 'application/json',
      }),
    });
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    const auth = res.headers.find((h) => h.name.toLowerCase() === 'authorization');
    const cookie = res.headers.find((h) => h.name.toLowerCase() === 'set-cookie');
    expect(auth?.redacted).toBe(true);
    expect(auth?.value).toBe('<redacted>');
    expect(cookie?.redacted).toBe(true);
    expect(res.redactedHeaders).toContain('authorization');
    expect(res.redactedHeaders).toContain('set-cookie');
  });

  it('redacts user-added sensitive header names', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      headers: new Headers({ 'x-secret-token': 'xyz' }),
    });
    const res = await executeHttpRequest(makeRequest(), {
      fetchImpl,
      userSensitiveHeaders: ['X-Secret-Token'],
    });
    const secret = res.headers.find(
      (h) => h.name.toLowerCase() === 'x-secret-token'
    );
    expect(secret?.redacted).toBe(true);
    expect(res.redactedHeaders).toContain('x-secret-token');
  });

  it('does NOT redact a non-matching look-alike header', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      headers: new Headers({ 'document-authorization-date': '2026' }),
    });
    const res = await executeHttpRequest(makeRequest(), { fetchImpl });
    const look = res.headers.find(
      (h) => h.name.toLowerCase() === 'document-authorization-date'
    );
    expect(look?.redacted).toBe(false);
  });

  it('returns network-error on malformed URL', async () => {
    const fetchImpl = mockFetch({ status: 200 });
    const res = await executeHttpRequest(makeRequest({ url: 'not a url' }), {
      fetchImpl,
    });
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/invalid url/i);
  });

  it('caps the response body at the configured limit', async () => {
    const big = 'x'.repeat(1024);
    const fetchImpl = mockFetch({
      status: 200,
      _body: big,
    });
    const res = await executeHttpRequest(makeRequest(), {
      fetchImpl,
      maxResponseBodyBytes: 256,
    });
    expect(res.tooLarge).toBe(true);
    expect(res.kind).toBe('too-large');
    expect(res.body.length).toBeLessThanOrEqual(256);
  });

  it('skips body on GET / HEAD / OPTIONS even when request.body is set', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response('', { status: 200 });
    };
    for (const method of ['GET', 'HEAD', 'OPTIONS'] as const) {
      captured = undefined;
      await executeHttpRequest(
        makeRequest({
          method,
          body: { kind: 'json', content: '{"a":1}' },
        }),
        { fetchImpl: fetchImpl as typeof fetch }
      );
      expect(captured?.body).toBeUndefined();
    }
  });

  it('refuses to send POST bodies over the 1 MiB request cap', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const big = 'é'.repeat(600_000);
    const res = await executeHttpRequest(
      makeRequest({
        method: 'POST',
        body: { kind: 'text', content: big },
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/1 MiB cap/);
  });

  it('sends body + auto-Content-Type on POST with JSON body', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await executeHttpRequest(
      makeRequest({
        method: 'POST',
        body: { kind: 'json', content: '{"a":1}' },
      }),
      { fetchImpl: fetchImpl as typeof fetch }
    );
    expect(captured?.body).toBe('{"a":1}');
    const headers = captured?.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('injects the Auth sub-tab header on send (Bearer)', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response('', { status: 200 });
    };
    await executeHttpRequest(
      makeRequest({ auth: { kind: 'bearer', token: 'tok-123' } }),
      { fetchImpl: fetchImpl as typeof fetch }
    );
    const headers = captured?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok-123');
  });

  it('injects a Basic auth header and lets it override a manual row', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response('', { status: 200 });
    };
    await executeHttpRequest(
      makeRequest({
        headers: [{ name: 'Authorization', value: 'Bearer stale', enabled: true }],
        auth: { kind: 'basic', username: 'aladdin', password: 'open sesame' },
      }),
      { fetchImpl: fetchImpl as typeof fetch }
    );
    const headers = captured?.headers as Headers;
    expect(headers.get('authorization')).toBe('Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  it('injects an API-key header under a custom name', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      captured = init;
      return new Response('', { status: 200 });
    };
    await executeHttpRequest(
      makeRequest({
        auth: { kind: 'apiKey', apiKeyHeader: 'X-Api-Key', apiKeyValue: 'k3y' },
      }),
      { fetchImpl: fetchImpl as typeof fetch }
    );
    const headers = captured?.headers as Headers;
    expect(headers.get('x-api-key')).toBe('k3y');
  });
});

describe('statusBucketForResponse', () => {
  it('maps typed failures to their dedicated buckets', () => {
    expect(
      statusBucketForResponse({
        version: 1,
        kind: 'network-error',
        status: 0,
        statusText: '',
        url: '',
        finalUrl: '',
        headers: [],
        body: '',
        contentType: '',
        sizeBytes: 0,
        durationMs: 0,
        tooLarge: false,
        redactedHeaders: [],
        recordedAt: '',
      })
    ).toBe('network-error');
  });
});

describe('effectiveSensitiveHeaderSet', () => {
  it('always includes baseline names + adds user names lowercased', () => {
    const set = effectiveSensitiveHeaderSet(['X-Custom', '  X-Whitespace  ']);
    expect(set.has('authorization')).toBe(true);
    expect(set.has('cookie')).toBe(true);
    expect(set.has('x-custom')).toBe(true);
    expect(set.has('x-whitespace')).toBe(true);
  });

  it('drops empty / whitespace-only user entries', () => {
    const set = effectiveSensitiveHeaderSet(['', '   ']);
    expect(set.has('')).toBe(false);
  });
});

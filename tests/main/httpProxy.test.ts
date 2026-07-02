/**
 * RL-097 T7 — main-process HTTP proxy engine.
 *
 * Covers the SSRF guard (literal private ranges, DNS-resolved private
 * targets, localhost, scheme allowlist, opt-in bypass), the shared
 * `HttpResponseV1` envelope mapping (success / client-error / server-error),
 * the body cap + too-large flag, header redaction, the timeout branch, and
 * manual redirect following (including redirect-to-private rejection and the
 * hop cap). Everything runs against a mocked `fetch` + `lookup`; no real
 * network or DNS is touched.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  executeHttpProxyRequest,
  isPrivateAddress,
  type LookupImpl,
} from '../../src/main/httpProxy';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
} from '../../src/shared/httpWorkspace';

function makeRequest(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({ id: 'r1', now: '2026-05-26T00:00:00.000Z' }),
    url: 'https://api.example.com/users',
    method: 'GET',
    ...overrides,
  };
}

/** DNS mock that always resolves to a public address. */
const publicLookup: LookupImpl = async () => [
  { address: '93.184.216.34', family: 4 },
];

/** DNS mock that resolves to a loopback address (rebind-style attacker). */
const privateLookup: LookupImpl = async () => [
  { address: '127.0.0.1', family: 4 },
];

function mockFetch(
  response: Partial<Response> & { _body?: string }
): typeof fetch {
  return (async () => {
    const body = response._body ?? '';
    const headers = response.headers ?? new Headers();
    return new Response(body, {
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      headers,
    });
  }) as typeof fetch;
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1', // multicast
    '::1',
    'fe80::1', // link-local
    'fc00::1', // unique-local
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    'not-an-ip',
  ])('flags %s as private/unsafe', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1', // just below the RFC 1918 172.16/12 block
    '172.32.0.1', // just above it
    '2606:2800:220:1:248:1893:25c8:1946',
  ])('allows public address %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('executeHttpProxyRequest — SSRF guard', () => {
  it('blocks a request to a loopback IP literal', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200 }));
    const res = await executeHttpProxyRequest(
      makeRequest({ url: 'http://127.0.0.1:8080/admin' }),
      { fetchImpl, lookupImpl: publicLookup }
    );
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/private address/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks the cloud metadata endpoint', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200 }));
    const res = await executeHttpProxyRequest(
      makeRequest({ url: 'http://169.254.169.254/latest/meta-data/' }),
      { fetchImpl, lookupImpl: publicLookup }
    );
    expect(res.kind).toBe('network-error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks localhost by name', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200 }));
    const res = await executeHttpProxyRequest(
      makeRequest({ url: 'http://localhost:3000/' }),
      { fetchImpl, lookupImpl: publicLookup }
    );
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/localhost/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks a public hostname that resolves to a private address', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200 }));
    const res = await executeHttpProxyRequest(
      makeRequest({ url: 'https://evil.example.com/' }),
      { fetchImpl, lookupImpl: privateLookup }
    );
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/private address 127\.0\.0\.1/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200 }));
    const res = await executeHttpProxyRequest(
      makeRequest({ url: 'file:///etc/passwd' }),
      { fetchImpl, lookupImpl: publicLookup }
    );
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/scheme/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows a private target when allowPrivateHosts is opted in', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200, _body: 'ok' }));
    const res = await executeHttpProxyRequest(
      makeRequest({ url: 'http://127.0.0.1:8080/health' }),
      { fetchImpl, lookupImpl: publicLookup, allowPrivateHosts: true }
    );
    expect(res.kind).toBe('success');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('executeHttpProxyRequest — response mapping', () => {
  it('maps a 2xx into a success envelope with headers + body', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      _body: '{"ok":true}',
    });
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(res.kind).toBe('success');
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.contentType).toBe('application/json');
    expect(res.version).toBe(1);
  });

  it('classifies 4xx / 5xx', async () => {
    const notFound = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl: mockFetch({ status: 404, statusText: 'Not Found' }),
      lookupImpl: publicLookup,
    });
    expect(notFound.kind).toBe('client-error');
    const boom = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl: mockFetch({ status: 503, statusText: 'Unavailable' }),
      lookupImpl: publicLookup,
    });
    expect(boom.kind).toBe('server-error');
  });

  it('redacts sensitive response headers', async () => {
    const fetchImpl = mockFetch({
      status: 200,
      headers: new Headers({
        authorization: 'Bearer secret',
        'x-custom': 'visible',
      }),
    });
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    const auth = res.headers.find((h) => h.name.toLowerCase() === 'authorization');
    expect(auth?.redacted).toBe(true);
    expect(auth?.value).toBe('<redacted>');
    expect(res.redactedHeaders).toContain('authorization');
    const custom = res.headers.find((h) => h.name.toLowerCase() === 'x-custom');
    expect(custom?.redacted).toBe(false);
  });

  it('caps the response body and flags too-large', async () => {
    const big = 'x'.repeat(500);
    const fetchImpl = mockFetch({ status: 200, _body: big });
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: publicLookup,
      maxResponseBodyBytes: 100,
    });
    expect(res.kind).toBe('too-large');
    expect(res.tooLarge).toBe(true);
    expect(res.body.length).toBe(100);
    expect(res.sizeBytes).toBe(500);
  });
});

describe('executeHttpProxyRequest — failure branches', () => {
  it('surfaces a timeout when the request aborts on the deadline', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as typeof fetch;
    const res = await executeHttpProxyRequest(
      makeRequest({ timeoutMs: 10 }),
      { fetchImpl, lookupImpl: publicLookup }
    );
    expect(res.kind).toBe('timeout');
    expect(res.errorMessage).toMatch(/timed out/i);
  });

  it('surfaces a generic fetch failure as network-error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/failed to fetch/i);
  });

  it('rejects an oversized request body before sending', async () => {
    const fetchImpl = vi.fn(mockFetch({ status: 200 }));
    const res = await executeHttpProxyRequest(
      makeRequest({
        method: 'POST',
        body: { kind: 'text', content: 'y'.repeat(1_048_577) },
      }),
      { fetchImpl, lookupImpl: publicLookup }
    );
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/1 mib/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('executeHttpProxyRequest — redirects', () => {
  it('follows a redirect to a public target and re-guards each hop', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url === 'https://api.example.com/users') {
        return new Response('', {
          status: 302,
          headers: new Headers({ location: 'https://api.example.com/v2/users' }),
        });
      }
      return new Response('{"final":true}', { status: 200 });
    }) as typeof fetch;
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(res.kind).toBe('success');
    expect(res.body).toBe('{"final":true}');
    expect(calls).toHaveLength(2);
    expect(res.finalUrl).toContain('/v2/users');
  });

  it('blocks a redirect that points at a private host', async () => {
    const lookup: LookupImpl = async (hostname) =>
      hostname === 'api.example.com'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '10.0.0.5', family: 4 }];
    const fetchImpl = (async (url: string) => {
      if (url === 'https://api.example.com/users') {
        return new Response('', {
          status: 302,
          headers: new Headers({ location: 'https://internal.example.com/' }),
        });
      }
      return new Response('should-not-reach', { status: 200 });
    }) as typeof fetch;
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: lookup,
    });
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/private address 10\.0\.0\.5/);
  });

  it('gives up after the redirect cap', async () => {
    const fetchImpl = (async (url: string) => {
      // Always redirect to a fresh public URL.
      const next = new URL(url);
      next.pathname = `${next.pathname}/x`;
      return new Response('', {
        status: 307,
        headers: new Headers({ location: next.toString() }),
      });
    }) as typeof fetch;
    const res = await executeHttpProxyRequest(makeRequest(), {
      fetchImpl,
      lookupImpl: publicLookup,
      maxRedirects: 3,
    });
    expect(res.kind).toBe('network-error');
    expect(res.errorMessage).toMatch(/maximum of 3 redirects/i);
  });
});

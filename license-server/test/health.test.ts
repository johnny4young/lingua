import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import {
  SERVER_NAME,
  SERVER_VERSION,
  _resetReadinessProbeCache,
} from '../src/handlers/health';
import { createMockEnv } from './helpers';

describe('GET /health', () => {
  it('returns ok:true with the server name + version so uptime monitors can pin a known shape', async () => {
    const response = await app.request('http://localhost/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; server: string; version: string };
    expect(body).toEqual({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  });

  it('does not allow caching the health response', async () => {
    const response = await app.request('http://localhost/health');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects POST on /health as 405 with the tagged-union JSON shape', async () => {
    const response = await app.request('http://localhost/health', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('method-not-allowed');
  });
});

describe('GET /health/ready', () => {
  beforeEach(() => {
    _resetReadinessProbeCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true with empty degraded[] when every dependency probe succeeds', async () => {
    const env = createMockEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await app.request('http://localhost/health/ready', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      server: string;
      version: string;
      degraded: string[];
      dependencies: Record<string, string>;
    };
    expect(body.ok).toBe(true);
    expect(body.server).toBe(SERVER_NAME);
    expect(body.version).toBe(SERVER_VERSION);
    expect(body.degraded).toEqual([]);
    expect(body.dependencies).toEqual({
      d1: 'ok',
      kv: 'ok',
      polar: 'ok',
      resend: 'ok',
    });
  });

  it('flags polar + resend as degraded when their HTTP probes return 5xx', async () => {
    const env = createMockEnv();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('polar.sh') || url.includes('resend.com')) {
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 200 });
    });

    const response = await app.request('http://localhost/health/ready', {}, env);
    const body = (await response.json()) as {
      ok: boolean;
      degraded: string[];
      dependencies: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.degraded.sort()).toEqual(['polar', 'resend']);
    expect(body.dependencies.polar).toBe('degraded');
    expect(body.dependencies.resend).toBe('degraded');
    expect(body.dependencies.d1).toBe('ok');
    expect(body.dependencies.kv).toBe('ok');
  });

  it('flags D1 as degraded when the probe throws', async () => {
    const env = createMockEnv();
    // Stub the prepared statement so .first() throws synchronously
    // through the promise chain.
    env.DB = {
      prepare: () => ({
        first: () => Promise.reject(new Error('D1_TYPE_ERROR: bad bind')),
      }),
    } as unknown as D1Database;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const response = await app.request('http://localhost/health/ready', {}, env);
    const body = (await response.json()) as {
      ok: boolean;
      degraded: string[];
      dependencies: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.degraded).toContain('d1');
    expect(body.dependencies.d1).toBe('degraded');
  });

  it('returns ok:true even when degraded so the uptime monitor can read the snapshot', async () => {
    // The contract is "200 always — the snapshot itself is the
    // signal". A 503 would prevent dashboards from seeing the
    // dependencies map.
    const env = createMockEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 }),
    );

    const response = await app.request('http://localhost/health/ready', {}, env);
    expect(response.status).toBe(200);
  });

  it('caches probe results so a repeated call within 30s does not refire dependency probes', async () => {
    const env = createMockEnv();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await app.request('http://localhost/health/ready', {}, env);
    const firstCallCount = fetchSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await app.request('http://localhost/health/ready', {}, env);
    expect(fetchSpy.mock.calls.length).toBe(firstCallCount);
  });

  it('rejects POST on /health/ready as 405', async () => {
    const response = await app.request('http://localhost/health/ready', {
      method: 'POST',
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });
});

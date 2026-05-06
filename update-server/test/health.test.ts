import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { resetReadinessProbeCacheForTests, SERVER_NAME, SERVER_VERSION } from '../src/index';
import type { Env } from '../src/index';

const stubEnv: Env = { GITHUB_TOKEN: 'test-token' };

describe('GET /health (update-server)', () => {
  it('returns ok:true with server name + version', async () => {
    const request = new Request('https://updates.linguacode.dev/health');
    const response = await worker.fetch(request, stubEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; server: string; version: string };
    expect(body).toEqual({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  });

  it('GET / behaves the same as /health for backward compatibility', async () => {
    const request = new Request('https://updates.linguacode.dev/');
    const response = await worker.fetch(request, stubEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('rejects POST /health with 405', async () => {
    const request = new Request('https://updates.linguacode.dev/health', {
      method: 'POST',
    });
    const response = await worker.fetch(request, stubEnv);
    expect(response.status).toBe(405);
  });
});

describe('GET /health/ready (update-server)', () => {
  beforeEach(() => {
    resetReadinessProbeCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true with empty degraded[] when GitHub probe succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Be careful with that ax, Eugene', { status: 200 }),
    );

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready'),
      stubEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      degraded: string[];
      dependencies: Record<string, string>;
    };
    expect(body.ok).toBe(true);
    expect(body.degraded).toEqual([]);
    expect(body.dependencies).toEqual({ github: 'ok' });
  });

  it('flags github as degraded when the probe returns 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 }),
    );

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready'),
      stubEnv,
    );
    const body = (await response.json()) as {
      ok: boolean;
      degraded: string[];
      dependencies: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.degraded).toEqual(['github']);
    expect(body.dependencies.github).toBe('degraded');
  });

  it('flags github as degraded when the probe throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready'),
      stubEnv,
    );
    const body = (await response.json()) as { ok: boolean; degraded: string[] };
    expect(body.ok).toBe(false);
    expect(body.degraded).toEqual(['github']);
  });

  it('returns 200 even when degraded so dashboards can read the snapshot', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 }),
    );

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready'),
      stubEnv,
    );
    expect(response.status).toBe(200);
  });

  it('caches the probe result for 30s so a polling monitor does not pile up on github', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('zen', { status: 200 }));

    await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready'),
      stubEnv,
    );
    const firstCount = fetchSpy.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready'),
      stubEnv,
    );
    expect(fetchSpy.mock.calls.length).toBe(firstCount);
  });

  it('rejects POST /health/ready with 405', async () => {
    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/health/ready', { method: 'POST' }),
      stubEnv,
    );
    expect(response.status).toBe(405);
  });
});

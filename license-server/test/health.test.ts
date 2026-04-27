import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { SERVER_NAME, SERVER_VERSION } from '../src/handlers/health';

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

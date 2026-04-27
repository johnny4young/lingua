import { describe, expect, it } from 'vitest';
import app from '../src/index';

const VALID_BODY = {
  email: 'buyer@example.com',
  deviceId: 'device-uuid',
  deviceName: 'MacBook Pro 16',
  os: 'darwin',
};

async function postJson(path: string, body: unknown): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /trials/start', () => {
  it('returns 501 not-implemented for a well-shaped body so Slice 2 can drop in real minting later', async () => {
    const response = await postJson('/trials/start', VALID_BODY);
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('not-implemented');
    expect(body.message).toMatch(/Slice 2/);
  });

  it('rejects a non-JSON body before the validator runs', async () => {
    const response = await app.request('http://localhost/trials/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body).toMatchObject({ ok: false, reason: 'invalid-input' });
  });

  it('rejects a missing email with an issue-list explaining the problem', async () => {
    const response = await postJson('/trials/start', { ...VALID_BODY, email: '' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string; issues: string[] };
    expect(body.reason).toBe('invalid-input');
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/email is required/)]));
  });

  it('rejects an email that does not match the basic local@host pattern', async () => {
    const response = await postJson('/trials/start', { ...VALID_BODY, email: 'no-at-sign' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/malformed/)]));
  });

  it('rejects an OS outside the known triple', async () => {
    const response = await postJson('/trials/start', { ...VALID_BODY, os: 'beos' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^os must be one of/)]));
  });

  it('rejects an empty deviceId', async () => {
    const response = await postJson('/trials/start', { ...VALID_BODY, deviceId: '   ' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/deviceId is required/)]));
  });

  it('rejects an empty deviceName', async () => {
    const response = await postJson('/trials/start', { ...VALID_BODY, deviceName: '' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/deviceName is required/)]));
  });

  it('rejects a non-object body without crashing the worker', async () => {
    const response = await postJson('/trials/start', 'a string instead of an object');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason: string; issues: string[] };
    expect(body.reason).toBe('invalid-input');
    expect(body.issues[0]).toMatch(/JSON object/);
  });

  it('rejects oversized fields so a megabyte deviceName never reaches the D1 INSERT path in Slice 2', async () => {
    const oversized = 'a'.repeat(10_000);
    const response = await postJson('/trials/start', {
      ...VALID_BODY,
      deviceName: oversized,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/deviceName exceeds .* byte cap/)]),
    );
  });

  it('rejects an oversized email beyond the RFC 5321 254 byte cap', async () => {
    const oversized = `${'a'.repeat(260)}@example.com`;
    const response = await postJson('/trials/start', { ...VALID_BODY, email: oversized });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/email exceeds .* byte cap/)]),
    );
  });

  it('rejects an oversized deviceId beyond the 128 byte cap', async () => {
    const response = await postJson('/trials/start', {
      ...VALID_BODY,
      deviceId: 'a'.repeat(200),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/deviceId exceeds .* byte cap/)]),
    );
  });

  it('measures the deviceName cap in UTF-8 bytes, not JavaScript string length', async () => {
    const response = await postJson('/trials/start', {
      ...VALID_BODY,
      deviceName: 'é'.repeat(200),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/deviceName exceeds .* byte cap/)]),
    );
  });

  it('returns 405 for method mismatches on a known route', async () => {
    const response = await app.request('http://localhost/trials/start');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'method-not-allowed' });
  });
});

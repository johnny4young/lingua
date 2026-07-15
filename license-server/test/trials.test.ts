import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { createMockEnv } from './helpers';

const VALID_BODY = {
  email: 'buyer@example.com',
  deviceId: 'device-uuid',
  deviceName: 'MacBook Pro 16',
  os: 'darwin',
};

async function postJson(path: string, body: unknown): Promise<Response> {
  return app.request(
    `http://localhost${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    createMockEnv()
  );
}

describe('POST /trials/start', () => {
  it('returns 501 not-implemented when LINGUA_LICENSE_PRIVATE_KEY_JWK is not configured (Slice 4 dev-disabled fallback)', async () => {
    const response = await postJson('/trials/start', VALID_BODY);
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('not-implemented');
    expect(body.message).toMatch(/LINGUA_LICENSE_PRIVATE_KEY_JWK/);
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

  it('rejects a malformed OS string (uppercase, whitespace, HTML-bait)', async () => {
    // Slice 3 follow-up: the os field is informational so we no longer
    // gate on a fixed enum. The validator still bounces shape
    // violations.
    const response = await postJson('/trials/start', { ...VALID_BODY, os: 'Beos OS' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^os must be lowercase letters/)])
    );
  });

  it('accepts the web build OS string family alongside the desktop triple', async () => {
    // Regression guard for the Slice 2.5 wiring. Slice 4 will surface
    // /trials/start to web users too; without the validator
    // relaxation, every web trial-start would bounce with
    // `invalid-input` for the same reason every web activate did.
    for (const os of ['darwin', 'win32', 'linux', 'web-chrome', 'web-firefox', 'web-unknown']) {
      const response = await postJson('/trials/start', { ...VALID_BODY, os });
      expect(response.status).not.toBe(400);
      const body = (await response.json()) as { ok: boolean; issues?: string[] };
      expect(body.issues).toBeUndefined();
    }
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

// --------------------------------------------- Slice 4 — real flow tests

describe('POST /trials/start — real flow (Slice 4)', () => {
  async function generateKeypair(): Promise<{ privateKeyJwk: JsonWebKey; publicKeyJwk: JsonWebKey }> {
    const keys = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    return {
      privateKeyJwk: (await crypto.subtle.exportKey('jwk', keys.privateKey)) as JsonWebKey,
      publicKeyJwk: (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey,
    };
  }

  async function postJsonWithEnv(
    path: string,
    body: unknown,
    env: ReturnType<typeof createMockEnv>
  ): Promise<Response> {
    return app.request(
      `http://localhost${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env
    );
  }

  it('mints a tier=trial token, persists license + trial rows, returns the token in body for auto-paste', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateKeypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    const response = await postJsonWithEnv('/trials/start', VALID_BODY, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      licenseId: string;
      token: string;
      tier: string;
      expiresAt: number;
      emailDelivered: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.tier).toBe('trial');
    expect(typeof body.token).toBe('string');
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // 14-day expiry
    const fourteenDays = 14 * 24 * 60 * 60;
    expect(body.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(fourteenDays - 60);
    expect(body.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThan(fourteenDays + 60);
    // No RESEND_API_KEY in this env → emailDelivered should be false
    expect(body.emailDelivered).toBe(false);
    // Both rows persisted
    expect(env.__db.licenses.size).toBe(1);
    expect(env.__db.trials.size).toBe(1);
  });

  it('returns generic trial-unavailable + canRecover when the email already has a trial', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateKeypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    // First trial succeeds
    const first = await postJsonWithEnv('/trials/start', VALID_BODY, env);
    expect(first.status).toBe(200);

    // Second trial with SAME email but DIFFERENT device → rejected by email
    const second = await postJsonWithEnv(
      '/trials/start',
      { ...VALID_BODY, deviceId: 'a-different-device' },
      env
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { ok: boolean; reason: string; canRecover: boolean };
    expect(body).toEqual({
      protocolVersion: 1,
      ok: false,
      reason: 'trial-unavailable',
      canRecover: true,
    });
  });

  it('returns generic trial-unavailable when the device id already has a trial', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateKeypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    const first = await postJsonWithEnv('/trials/start', VALID_BODY, env);
    expect(first.status).toBe(200);

    // Same device, different email
    const second = await postJsonWithEnv(
      '/trials/start',
      { ...VALID_BODY, email: 'someone-else@example.com' },
      env
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      ok: boolean;
      reason: string;
      canRecover: boolean;
    };
    expect(body).toEqual({
      protocolVersion: 1,
      ok: false,
      reason: 'trial-unavailable',
      canRecover: true,
    });
  });

  it('rate-limits the 4th hit per IP per day with retryAfter', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateKeypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    const fixedHeaders = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.4' };
    async function hit(emailSuffix: string, deviceId: string): Promise<Response> {
      return app.request(
        'http://localhost/trials/start',
        {
          method: 'POST',
          headers: fixedHeaders,
          body: JSON.stringify({ ...VALID_BODY, email: `user-${emailSuffix}@example.com`, deviceId }),
        },
        env
      );
    }

    // Three hits succeed (different email + device each so anti-abuse passes)
    expect((await hit('a', 'd1')).status).toBe(200);
    expect((await hit('b', 'd2')).status).toBe(200);
    expect((await hit('c', 'd3')).status).toBe(200);
    // Fourth hit from the SAME IP is rate-limited
    const fourth = await hit('d', 'd4');
    expect(fourth.status).toBe(429);
    const body = (await fourth.json()) as { ok: boolean; reason: string; retryAfter: number };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('rate-limited');
    expect(body.retryAfter).toBeGreaterThan(0);
  });
});

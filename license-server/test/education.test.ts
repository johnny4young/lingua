/**
 * Tests for the Education endpoints .
 *
 *   POST /education/start             validate + persist pending + email
 *   GET  /education/confirm?confirm=  mint + persist + send token email
 *   POST /education/renew             re-mint extending expires_at by 1y
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { signLicenseToken, type LicensePayload } from '../src/lib/sign';
import { createMockEnv, generateEd25519Keypair } from './helpers';

const VALID_BODY = {
  email: 'student@stanford.edu',
  deviceId: 'device-uuid',
  deviceName: 'MacBook Air',
  os: 'darwin',
};

async function postJson(
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

async function getRequest(
  path: string,
  env: ReturnType<typeof createMockEnv>
): Promise<Response> {
  return app.request(`http://localhost${path}`, { method: 'GET' }, env);
}

function stubResendSuccess(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ id: `em_${crypto.randomUUID()}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  );
}

function latestEducationPendingId(env: ReturnType<typeof createMockEnv>): string {
  const ids = [...env.__db.educationPending.keys()];
  const id = ids[ids.length - 1];
  if (!id) throw new Error('expected an education pending row');
  return id;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /education/start', () => {
  it('returns confirmation-email-failed when the confirmation email cannot be sent', async () => {
    const env = createMockEnv();
    const response = await postJson('/education/start', VALID_BODY, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'confirmation-email-failed' });
  });

  it('rejects a non-edu email with reason: not-educational', async () => {
    const env = createMockEnv();
    const response = await postJson('/education/start', { ...VALID_BODY, email: 'me@gmail.com' }, env);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toEqual({ ok: false, reason: 'not-educational' });
  });

  it('persists a pending row with a fresh confirm-token id and 24h expiry', async () => {
    stubResendSuccess();
    const env = createMockEnv({ resendApiKey: 're_test_key' });
    const response = await postJson('/education/start', VALID_BODY, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      pending: boolean;
      expiresAt: number;
    };
    expect(body.ok).toBe(true);
    expect(env.__db.educationPending.size).toBe(1);
    const pending = [...env.__db.educationPending.values()][0]!;
    expect(pending.email).toBe(VALID_BODY.email);
    expect(pending.confirmed_at).toBeNull();
    // 24h expiry
    expect(body.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(23 * 60 * 60);
    expect(body.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThan(25 * 60 * 60);
  });

  it('returns generic education-unavailable + canRecover when the email already has an Education plan', async () => {
    const env = createMockEnv();
    // Manually pre-seed an education row
    env.__db.educations.set('edu_1', {
      id: 'edu_1',
      email: VALID_BODY.email,
      device_id: 'some-other-device',
      license_id: 'lic_1',
      issued_at: Math.floor(Date.now() / 1000),
    });

    const response = await postJson('/education/start', VALID_BODY, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; reason: string; canRecover: boolean };
    expect(body).toEqual({ ok: false, reason: 'education-unavailable', canRecover: true });
  });

  it('returns generic education-unavailable when the device has an Education plan under a different email', async () => {
    const env = createMockEnv();
    env.__db.educations.set('edu_1', {
      id: 'edu_1',
      email: 'someone-else@school.edu',
      device_id: VALID_BODY.deviceId,
      license_id: 'lic_1',
      issued_at: Math.floor(Date.now() / 1000),
    });

    const response = await postJson('/education/start', VALID_BODY, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      reason: string;
      canRecover: boolean;
    };
    expect(body).toEqual({ ok: false, reason: 'education-unavailable', canRecover: true });
  });

  it('rate-limits the 4th hit per IP per day', async () => {
    stubResendSuccess();
    const env = createMockEnv({ resendApiKey: 're_test_key' });
    const fixedHeaders = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5' };
    async function hit(emailSuffix: string, deviceId: string): Promise<Response> {
      return app.request(
        'http://localhost/education/start',
        {
          method: 'POST',
          headers: fixedHeaders,
          body: JSON.stringify({ ...VALID_BODY, email: `${emailSuffix}@stanford.edu`, deviceId }),
        },
        env
      );
    }
    expect((await hit('a', 'd1')).status).toBe(200);
    expect((await hit('b', 'd2')).status).toBe(200);
    expect((await hit('c', 'd3')).status).toBe(200);
    const fourth = await hit('d', 'd4');
    expect(fourth.status).toBe(429);
  });

  it('rejects a malformed email shape with invalid-input', async () => {
    const env = createMockEnv();
    const response = await postJson('/education/start', { ...VALID_BODY, email: 'no-at' }, env);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason: string };
    expect(body.reason).toBe('invalid-input');
  });
});

describe('GET /education/confirm', () => {
  it('mints + persists license + education row and returns success HTML on the happy path', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    stubResendSuccess();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk, resendApiKey: 're_test_key' });

    // Seed via /start
    const startResponse = await postJson('/education/start', VALID_BODY, env);
    expect(startResponse.status).toBe(200);
    await startResponse.json();
    const pendingId = latestEducationPendingId(env);

    const confirmResponse = await getRequest(
      `/education/confirm?confirm=${encodeURIComponent(pendingId)}`,
      env
    );
    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.headers.get('content-type')).toContain('text/html');
    const html = await confirmResponse.text();
    expect(html).toContain('Education plan confirmed');

    // License + education rows persisted
    expect(env.__db.licenses.size).toBe(1);
    expect(env.__db.educations.size).toBe(1);
    const educationRow = [...env.__db.educations.values()][0]!;
    expect(educationRow.email).toBe(VALID_BODY.email);
    expect(educationRow.device_id).toBe(VALID_BODY.deviceId);

    // Pending row marked confirmed
    const pendingRow = [...env.__db.educationPending.values()][0]!;
    expect(pendingRow.confirmed_at).not.toBeNull();
  });

  it('is idempotent on a second click — does NOT mint a second license', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    stubResendSuccess();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk, resendApiKey: 're_test_key' });

    const startResponse = await postJson('/education/start', VALID_BODY, env);
    expect(startResponse.status).toBe(200);
    await startResponse.json();
    const pendingId = latestEducationPendingId(env);

    await getRequest(`/education/confirm?confirm=${pendingId}`, env);
    expect(env.__db.licenses.size).toBe(1);

    // Second click
    const second = await getRequest(`/education/confirm?confirm=${pendingId}`, env);
    expect(second.status).toBe(200);
    const html = await second.text();
    expect(html).toContain('already active');
    expect(env.__db.licenses.size).toBe(1); // no second mint
  });

  it('does not mint a second license when another pending link for the same email is clicked later', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    stubResendSuccess();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk, resendApiKey: 're_test_key' });

    const firstStart = await postJson('/education/start', VALID_BODY, env);
    expect(firstStart.status).toBe(200);
    await firstStart.json();
    const firstPendingId = latestEducationPendingId(env);
    const secondStart = await postJson(
      '/education/start',
      { ...VALID_BODY, deviceId: 'same-student-second-pending' },
      env
    );
    expect(secondStart.status).toBe(200);
    await secondStart.json();
    const secondPendingId = latestEducationPendingId(env);

    await getRequest(`/education/confirm?confirm=${firstPendingId}`, env);
    expect(env.__db.licenses.size).toBe(1);
    expect(env.__db.educations.size).toBe(1);

    const secondConfirm = await getRequest(`/education/confirm?confirm=${secondPendingId}`, env);
    expect(secondConfirm.status).toBe(200);
    const html = await secondConfirm.text();
    expect(html).toContain('already active');
    expect(env.__db.licenses.size).toBe(1);
    expect(env.__db.educations.size).toBe(1);
  });

  it('returns expired HTML on a 24h-stale pending row', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    // Seed an expired pending row directly
    const pendingId = 'expired-uuid';
    env.__db.educationPending.set(pendingId, {
      id: pendingId,
      email: VALID_BODY.email,
      device_id: VALID_BODY.deviceId,
      device_name: VALID_BODY.deviceName,
      os: VALID_BODY.os,
      created_at: Math.floor(Date.now() / 1000) - 48 * 60 * 60,
      expires_at: Math.floor(Date.now() / 1000) - 24 * 60 * 60,
      confirmed_at: null,
    });

    const response = await getRequest(`/education/confirm?confirm=${pendingId}`, env);
    expect(response.status).toBe(410);
    const html = await response.text();
    expect(html).toContain('expired');
  });

  it('returns not-found HTML on an unknown id', async () => {
    const env = createMockEnv();
    const response = await getRequest('/education/confirm?confirm=does-not-exist', env);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('not found');
  });

  it('returns invalid HTML on a missing confirm param', async () => {
    const env = createMockEnv();
    const response = await getRequest('/education/confirm', env);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('invalid');
  });
});

describe('POST /education/renew', () => {
  async function signEducationToken(
    privateKeyJwk: JsonWebKey,
    overrides: Partial<LicensePayload> = {}
  ): Promise<string> {
    const payload: LicensePayload = {
      licenseId: 'lic-edu-1',
      productId: 'lingua_education',
      tier: 'education',
      issuedTo: 'student@stanford.edu',
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      supportWindowEndsAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      entitlements: ['plugins'],
      ...overrides,
    };
    const result = await signLicenseToken(payload, privateKeyJwk);
    if (!result.ok) throw new Error(`sign failed: ${result.reason}`);
    return result.token;
  }

  it('extends expires_at by another year and re-mints the token', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    const token = await signEducationToken(privateKeyJwk);

    // Seed a license + education row
    const issuedAt = Math.floor(Date.now() / 1000);
    env.__db.licenses.set('lic-edu-1', {
      id: 'lic-edu-1',
      token,
      product_id: 'lingua_education',
      tier: 'education',
      device_limit: 3,
      issued_to: 'student@stanford.edu',
      issued_at: issuedAt,
      expires_at: issuedAt + 86_400 * 30, // 30 days remaining
      support_window_ends_at: issuedAt + 86_400 * 30,
      status: 'active',
      polar_order_id: null,
      polar_subscription_id: null,
      created_at: issuedAt,
      updated_at: issuedAt,
    });
    env.__db.educations.set('edu_1', {
      id: 'edu_1',
      email: 'student@stanford.edu',
      device_id: 'd1',
      license_id: 'lic-edu-1',
      issued_at: issuedAt,
    });

    const response = await postJson(
      '/education/renew',
      { token, email: 'student@stanford.edu' },
      env
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      licenseId: string;
      refreshedToken: string;
      expiresAt: number;
    };
    expect(body.ok).toBe(true);
    expect(body.licenseId).toBe('lic-edu-1');
    expect(body.refreshedToken).not.toBe(token); // fresh signed payload
    // ~1 year extension
    const oneYear = 365 * 24 * 60 * 60;
    expect(body.expiresAt - issuedAt).toBeGreaterThan(oneYear - 60);
  });

  it('rejects renewal when the email is no longer educational', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });
    const token = await signEducationToken(privateKeyJwk, { issuedTo: 'graduated@gmail.com' });

    const response = await postJson(
      '/education/renew',
      { token, email: 'graduated@gmail.com' },
      env
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toEqual({ ok: false, reason: 'not-educational' });
  });

  it('rejects renewal when the supplied email mismatches the token issuedTo', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });
    const token = await signEducationToken(privateKeyJwk);

    const response = await postJson(
      '/education/renew',
      { token, email: 'someone.else@stanford.edu' },
      env
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toEqual({ ok: false, reason: 'email-mismatch' });
  });
});

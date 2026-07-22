/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import migrationSql from '../migrations/0001_initial.sql?raw';
import migrationSqlSurface from '../migrations/0002_add_surface_column.sql?raw';
import app from '../src/index';
import { signLicenseToken, verifyLicenseToken, type LicensePayload } from '../src/lib/sign';
import { createMockEnv, generateEd25519Keypair } from './helpers';

const ACTIVATE_BODY = {
  token: 'payload.signature',
  deviceId: 'device-uuid',
  deviceName: 'MacBook Pro 16',
  os: 'darwin',
  surface: 'desktop',
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

async function signPayload(payload: LicensePayload, privateKeyJwk: JsonWebKey): Promise<string> {
  const signed = await signLicenseToken(payload, privateKeyJwk);
  if (!signed.ok) throw new Error(`sign failed: ${signed.reason}`);
  return signed.token;
}

describe('POST /licenses/activate', () => {
  it('returns 501 not-implemented when LINGUA_LICENSE_PUBLIC_KEY_JWK is not configured', async () => {
    const response = await postJson('/licenses/activate', ACTIVATE_BODY);
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'not-implemented' });
  });

  it('rejects an empty token', async () => {
    const response = await postJson('/licenses/activate', { ...ACTIVATE_BODY, token: '' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/token is required/)]));
  });

  it('rejects a malformed OS string', async () => {
    // implementation follow-up: the os field is informational (display in the
    // device list) so we no longer enforce a fixed enum at the server.
    // The validator still bounces shape violations — uppercase, spaces,
    // HTML-bait — so a compromised client cannot poison a peer's
    // device list with markup.
    const response = await postJson('/licenses/activate', {
      ...ACTIVATE_BODY,
      os: '<script>',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^os must be lowercase letters/)])
    );
  });

  it('accepts the web build OS string family (web-chrome, web-firefox, web-unknown)', async () => {
    // Regression guard for the implementation wiring. Before the
    // validator + D1 CHECK relaxation, every web activate against prod
    // bounced with `invalid-input` because the renderer's `getOs()`
    // emits `web-${browserFamily}` which the desktop-only enum
    // rejected. The endpoint stays a 501 stub here (implementation
    // scaffolding hasn't wired D1 to this test fixture), but the
    // request reaches the handler — that's enough to prove the
    // request body passed validation.
    for (const os of ['darwin', 'win32', 'linux', 'web-chrome', 'web-firefox', 'web-unknown']) {
      const response = await postJson('/licenses/activate', { ...ACTIVATE_BODY, os });
      expect(response.status).not.toBe(400);
      const body = (await response.json()) as { ok: boolean; issues?: string[] };
      expect(body.issues).toBeUndefined();
    }
  });

  it('rejects an unknown surface', async () => {
    const response = await postJson('/licenses/activate', { ...ACTIVATE_BODY, surface: 'mobile' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^surface must be one of/)])
    );
  });

  it('rejects a missing surface', async () => {
    const response = await postJson('/licenses/activate', {
      token: ACTIVATE_BODY.token,
      deviceId: ACTIVATE_BODY.deviceId,
      deviceName: ACTIVATE_BODY.deviceName,
      os: ACTIVATE_BODY.os,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^surface must be one of/)])
    );
  });

  it('rejects a malformed JSON body', async () => {
    const response = await app.request(
      'http://localhost/licenses/activate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ "token":',
      },
      createMockEnv()
    );
    expect(response.status).toBe(400);
  });

  it('rejects an oversized token so an attacker cannot force the verifier to allocate megabytes before rejecting in implementation', async () => {
    const oversized = 'a'.repeat(5_000);
    const response = await postJson('/licenses/activate', { ...ACTIVATE_BODY, token: oversized });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/token exceeds .* byte cap/)]),
    );
  });

  it('measures the token cap in UTF-8 bytes, not JavaScript string length', async () => {
    const response = await postJson('/licenses/activate', {
      ...ACTIVATE_BODY,
      token: 'é'.repeat(3_000),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/token exceeds .* byte cap/)]),
    );
  });

  it('returns 405 for method mismatches on /licenses/activate', async () => {
    const response = await app.request(
      'http://localhost/licenses/activate',
      undefined,
      createMockEnv()
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'method-not-allowed' });
  });

  it('rejects activation when the per-surface device slot is already full', async () => {
    const keys = await generateEd25519Keypair();
    const licenseId = 'lic_full';
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await signPayload(
      {
        licenseId,
        productId: 'lingua_lifetime',
        tier: 'pro_lifetime',
        issuedTo: 'buyer@example.com',
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        supportWindowEndsAt: new Date((issuedAt + 365 * 24 * 60 * 60) * 1000).toISOString(),
        entitlements: ['tabs'],
      },
      keys.privateKeyJwk
    );
    const env = createMockEnv({ publicKeyJwk: keys.publicKeyJwk });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token,
      product_id: 'lingua_lifetime',
      tier: 'pro',
      device_limit: 1,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: null,
      support_window_ends_at: issuedAt + 365 * 24 * 60 * 60,
      status: 'active',
      polar_order_id: 'order_full',
      polar_subscription_id: null,
      created_at: issuedAt,
      updated_at: issuedAt,
    });
    env.__db.devices.set('dev_existing', {
      id: 'dev_existing',
      license_id: licenseId,
      device_id: 'already-active',
      device_name: 'Existing Mac',
      os: 'darwin',
      surface: 'desktop',
      activated_at: issuedAt,
      last_seen_at: issuedAt,
      removed_at: null,
    });

    const response = await app.request(
      'http://localhost/licenses/activate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ACTIVATE_BODY, token, deviceId: 'new-device' }),
      },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; reason?: string };
    expect(body).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(env.__db.devices.size).toBe(1);
  });

  it('accepts an outstanding token through a verification-only overlap key', async () => {
    const currentKeys = await generateEd25519Keypair();
    const retiringKeys = await generateEd25519Keypair();
    const licenseId = 'lic_rotation_overlap';
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await signPayload(
      {
        licenseId,
        productId: 'lingua_lifetime',
        tier: 'pro_lifetime',
        issuedTo: 'buyer@example.com',
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        supportWindowEndsAt: new Date((issuedAt + 365 * 24 * 60 * 60) * 1000).toISOString(),
        entitlements: ['tabs'],
      },
      retiringKeys.privateKeyJwk
    );
    const env = createMockEnv({
      publicKeyring: [currentKeys.publicKeyJwk, retiringKeys.publicKeyJwk],
    });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token,
      product_id: 'lingua_lifetime',
      tier: 'pro_lifetime',
      device_limit: 3,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: null,
      support_window_ends_at: issuedAt + 365 * 24 * 60 * 60,
      status: 'active',
      polar_order_id: 'order_rotation_overlap',
      polar_subscription_id: null,
      created_at: issuedAt,
      updated_at: issuedAt,
    });

    const response = await app.request(
      'http://localhost/licenses/activate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ACTIVATE_BODY, token }),
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, activated: true });
  });
});

describe('GET /licenses/status', () => {
  it('returns 501 not-implemented when LINGUA_LICENSE_PUBLIC_KEY_JWK is not configured', async () => {
    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: 'Bearer payload.signature' } },
      createMockEnv()
    );
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'not-implemented' });
  });

  it('rejects a request without an Authorization header — never accepts the token via URL query because logs would leak it', async () => {
    const response = await app.request(
      'http://localhost/licenses/status?token=payload.signature&deviceId=device-uuid&surface=desktop',
      undefined,
      createMockEnv()
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/Authorization: Bearer/)]),
    );
  });

  it('rejects an Authorization header that omits the Bearer scheme', async () => {
    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: 'payload.signature' } },
      createMockEnv()
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/Authorization: Bearer/)]),
    );
  });

  it('rejects a missing deviceId query param even when the Authorization header is present', async () => {
    const response = await app.request(
      'http://localhost/licenses/status?surface=desktop',
      { headers: { authorization: 'Bearer payload.signature' } },
      createMockEnv()
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/deviceId is required/)]));
  });

  it('rejects a missing surface query param', async () => {
    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid',
      { headers: { authorization: 'Bearer payload.signature' } },
      createMockEnv()
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^surface must be one of/)])
    );
  });

  it('returns 405 for method mismatches on /licenses/status', async () => {
    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      {
        method: 'POST',
        headers: { authorization: 'Bearer payload.signature' },
      },
      createMockEnv()
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'method-not-allowed' });
  });

  it('returns refreshedToken when a renewal replaced the persisted token for the same license row', async () => {
    const keys = await generateEd25519Keypair();
    const licenseId = 'lic_refresh';
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const oldPayload: LicensePayload = {
      licenseId,
      productId: 'lingua_monthly',
      tier: 'pro',
      issuedTo: 'buyer@example.com',
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      supportWindowEndsAt: new Date((issuedAt + 30 * 24 * 60 * 60) * 1000).toISOString(),
      entitlements: ['tabs'],
    };
    const oldToken = await signPayload(oldPayload, keys.privateKeyJwk);
    const newToken = await signPayload(
      {
        ...oldPayload,
        supportWindowEndsAt: new Date((issuedAt + 60 * 24 * 60 * 60) * 1000).toISOString(),
      },
      keys.privateKeyJwk
    );
    const env = createMockEnv({ publicKeyJwk: keys.publicKeyJwk });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token: newToken,
      product_id: 'lingua_monthly',
      tier: 'pro',
      device_limit: 3,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: issuedAt + 60 * 24 * 60 * 60,
      support_window_ends_at: issuedAt + 60 * 24 * 60 * 60,
      status: 'active',
      polar_order_id: null,
      polar_subscription_id: 'sub_refresh',
      created_at: issuedAt,
      updated_at: issuedAt + 100,
    });

    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: `Bearer ${oldToken}` } },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; refreshedToken?: string };
    expect(body).toMatchObject({ ok: true, refreshedToken: newToken });
  });

  it.each([
    {
      name: 'tier disagrees with the canonical row',
      mutate: (payload: LicensePayload): LicensePayload => ({
        ...payload,
        tier: 'pro_lifetime',
      }),
    },
    {
      name: 'support window exceeds the canonical row',
      mutate: (payload: LicensePayload): LicensePayload => ({
        ...payload,
        supportWindowEndsAt: new Date(
          Date.parse(payload.supportWindowEndsAt) + 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
      }),
    },
  ])('rejects a historical signed token when its $name', async ({ mutate }) => {
    const keys = await generateEd25519Keypair();
    const licenseId = 'lic_historical_claim_mismatch';
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const supportWindowEndsAt = issuedAt + 30 * 24 * 60 * 60;
    const canonicalPayload: LicensePayload = {
      licenseId,
      productId: 'lingua_monthly',
      tier: 'pro',
      issuedTo: 'buyer@example.com',
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      supportWindowEndsAt: new Date(supportWindowEndsAt * 1000).toISOString(),
      entitlements: ['tabs'],
    };
    const historicalToken = await signPayload(mutate(canonicalPayload), keys.privateKeyJwk);
    const canonicalToken = await signPayload(canonicalPayload, keys.privateKeyJwk);
    const env = createMockEnv({ publicKeyJwk: keys.publicKeyJwk });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token: canonicalToken,
      product_id: 'lingua_monthly',
      tier: 'pro',
      device_limit: 3,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: supportWindowEndsAt,
      support_window_ends_at: supportWindowEndsAt,
      status: 'active',
      polar_order_id: null,
      polar_subscription_id: 'sub_claim_mismatch',
      created_at: issuedAt,
      updated_at: issuedAt,
    });

    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: `Bearer ${historicalToken}` } },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, reason: 'unknown-license' });
  });

  it('refreshes a retiring-key lifetime token to the current signing key', async () => {
    const currentKeys = await generateEd25519Keypair();
    const retiringKeys = await generateEd25519Keypair();
    const licenseId = 'lic_key_rotation_refresh';
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const payload: LicensePayload = {
      licenseId,
      productId: 'lingua_lifetime',
      tier: 'pro_lifetime',
      issuedTo: 'buyer@example.com',
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      supportWindowEndsAt: new Date((issuedAt + 365 * 24 * 60 * 60) * 1000).toISOString(),
      entitlements: ['tabs'],
    };
    const oldToken = await signPayload(payload, retiringKeys.privateKeyJwk);
    const refreshedToken = await signPayload(
      { ...payload, issuedAt: new Date((issuedAt + 30) * 1000).toISOString() },
      currentKeys.privateKeyJwk
    );
    const env = createMockEnv({
      publicKeyring: [currentKeys.publicKeyJwk, retiringKeys.publicKeyJwk],
    });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token: refreshedToken,
      product_id: 'lingua_lifetime',
      tier: 'pro_lifetime',
      device_limit: 3,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: null,
      support_window_ends_at: issuedAt + 365 * 24 * 60 * 60,
      status: 'active',
      polar_order_id: 'order_key_rotation_refresh',
      polar_subscription_id: null,
      created_at: issuedAt,
      updated_at: issuedAt + 30,
    });

    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: `Bearer ${oldToken}` } },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, refreshedToken });
  });

  it('lazily re-signs the canonical row when a retiring-key token first checks status', async () => {
    const currentKeys = await generateEd25519Keypair();
    const retiringKeys = await generateEd25519Keypair();
    const licenseId = 'lic_key_rotation_lazy_refresh';
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const payload: LicensePayload = {
      licenseId,
      productId: 'lingua_lifetime',
      tier: 'pro_lifetime',
      issuedTo: 'buyer@example.com',
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      supportWindowEndsAt: new Date((issuedAt + 365 * 24 * 60 * 60) * 1000).toISOString(),
      entitlements: ['tabs'],
    };
    const oldToken = await signPayload(payload, retiringKeys.privateKeyJwk);
    const env = createMockEnv({
      privateKeyJwk: retiringKeys.privateKeyJwk,
      nextPrivateKeyJwk: currentKeys.privateKeyJwk,
      signingKeySlot: 'next',
      publicKeyring: [currentKeys.publicKeyJwk, retiringKeys.publicKeyJwk],
    });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token: oldToken,
      product_id: 'lingua_lifetime',
      tier: 'pro_lifetime',
      device_limit: 3,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: null,
      support_window_ends_at: issuedAt + 365 * 24 * 60 * 60,
      status: 'active',
      polar_order_id: 'order_key_rotation_lazy_refresh',
      polar_subscription_id: null,
      created_at: issuedAt,
      updated_at: issuedAt,
    });

    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: `Bearer ${oldToken}` } },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; refreshedToken?: string };
    expect(body.refreshedToken).toBeTypeOf('string');
    expect(body.refreshedToken).not.toBe(oldToken);
    const verified = await verifyLicenseToken(body.refreshedToken ?? '', currentKeys.publicKeyJwk);
    expect(verified.ok).toBe(true);
    expect(env.__db.licenses.get(licenseId)?.token).toBe(body.refreshedToken);
  });

  it('withholds refreshedToken from a refunded license even when the row rotated (lifetime revocation lever)', async () => {
    const keys = await generateEd25519Keypair();
    const licenseId = 'lic_refunded_rotation';
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    const oldPayload: LicensePayload = {
      licenseId,
      productId: 'lingua_lifetime',
      tier: 'pro_lifetime',
      issuedTo: 'buyer@example.com',
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      supportWindowEndsAt: new Date((issuedAt + 365 * 24 * 60 * 60) * 1000).toISOString(),
      entitlements: ['tabs'],
    };
    const oldToken = await signPayload(oldPayload, keys.privateKeyJwk);
    const newToken = await signPayload(
      {
        ...oldPayload,
        supportWindowEndsAt: new Date((issuedAt + 2 * 365 * 24 * 60 * 60) * 1000).toISOString(),
      },
      keys.privateKeyJwk
    );
    const env = createMockEnv({ publicKeyJwk: keys.publicKeyJwk });
    env.__db.licenses.set(licenseId, {
      id: licenseId,
      token: newToken,
      product_id: 'lingua_lifetime',
      tier: 'pro_lifetime',
      device_limit: 3,
      issued_to: 'buyer@example.com',
      issued_at: issuedAt,
      expires_at: null,
      support_window_ends_at: issuedAt + 365 * 24 * 60 * 60,
      status: 'refunded',
      polar_order_id: 'order_refunded',
      polar_subscription_id: null,
      created_at: issuedAt,
      updated_at: issuedAt + 100,
    });

    const response = await app.request(
      'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
      { headers: { authorization: `Bearer ${oldToken}` } },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      status: string;
      refreshedToken?: string;
    };
    expect(body).toMatchObject({ ok: true, status: 'refunded' });
    expect(body.refreshedToken).toBeUndefined();
  });

  it('rejects a historical token after its refresh grace window has elapsed', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-05T00:00:00.000Z'));
      const keys = await generateEd25519Keypair();
      const licenseId = 'lic_stale_replay';
      const issuedAt = Math.floor(Date.parse('2025-12-01T00:00:00.000Z') / 1000);
      const oldSupportWindowEndsAt = Math.floor(
        Date.parse('2026-01-02T00:00:00.000Z') / 1000
      );
      const newSupportWindowEndsAt = Math.floor(
        Date.parse('2026-03-01T00:00:00.000Z') / 1000
      );
      const oldPayload: LicensePayload = {
        licenseId,
        productId: 'lingua_monthly',
        tier: 'pro',
        issuedTo: 'buyer@example.com',
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        supportWindowEndsAt: new Date(oldSupportWindowEndsAt * 1000).toISOString(),
        entitlements: ['tabs'],
      };
      const oldToken = await signPayload(oldPayload, keys.privateKeyJwk);
      const newToken = await signPayload(
        {
          ...oldPayload,
          supportWindowEndsAt: new Date(newSupportWindowEndsAt * 1000).toISOString(),
        },
        keys.privateKeyJwk
      );
      const env = createMockEnv({ publicKeyJwk: keys.publicKeyJwk });
      env.__db.licenses.set(licenseId, {
        id: licenseId,
        token: newToken,
        product_id: 'lingua_monthly',
        tier: 'pro',
        device_limit: 3,
        issued_to: 'buyer@example.com',
        issued_at: issuedAt,
        expires_at: newSupportWindowEndsAt,
        support_window_ends_at: newSupportWindowEndsAt,
        status: 'active',
        polar_order_id: null,
        polar_subscription_id: 'sub_stale',
        created_at: issuedAt,
        updated_at: newSupportWindowEndsAt,
      });

      const response = await app.request(
        'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
        { headers: { authorization: `Bearer ${oldToken}` } },
        env
      );

      expect(response.status).toBe(401);
      const body = (await response.json()) as { ok: boolean; reason?: string };
      expect(body).toMatchObject({ ok: false, reason: 'unknown-license' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports expired once a canceled subscription is outside the grace window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));
      const keys = await generateEd25519Keypair();
      const licenseId = 'lic_canceled_expired';
      const issuedAt = Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000);
      const supportWindowEndsAt = Math.floor(Date.parse('2026-03-01T00:00:00.000Z') / 1000);
      const token = await signPayload(
        {
          licenseId,
          productId: 'lingua_monthly',
          tier: 'pro',
          issuedTo: 'buyer@example.com',
          issuedAt: new Date(issuedAt * 1000).toISOString(),
          supportWindowEndsAt: new Date(supportWindowEndsAt * 1000).toISOString(),
          entitlements: ['tabs'],
        },
        keys.privateKeyJwk
      );
      const env = createMockEnv({ publicKeyJwk: keys.publicKeyJwk });
      env.__db.licenses.set(licenseId, {
        id: licenseId,
        token,
        product_id: 'lingua_monthly',
        tier: 'pro',
        device_limit: 3,
        issued_to: 'buyer@example.com',
        issued_at: issuedAt,
        expires_at: supportWindowEndsAt,
        support_window_ends_at: supportWindowEndsAt,
        status: 'cancel_at_period_end',
        polar_order_id: null,
        polar_subscription_id: 'sub_canceled',
        created_at: issuedAt,
        updated_at: supportWindowEndsAt,
      });

      const response = await app.request(
        'http://localhost/licenses/status?deviceId=device-uuid&surface=desktop',
        { headers: { authorization: `Bearer ${token}` } },
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; status?: string };
      expect(body).toMatchObject({ ok: true, status: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /licenses/devices/remove', () => {
  it('returns 501 not-implemented when LINGUA_LICENSE_PUBLIC_KEY_JWK is not configured', async () => {
    const response = await postJson('/licenses/devices/remove', {
      token: 'payload.signature',
      deviceIdToRemove: 'other-device',
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'not-implemented' });
  });

  it('rejects a body that omits deviceIdToRemove', async () => {
    const response = await postJson('/licenses/devices/remove', { token: 'abc.def' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/deviceIdToRemove is required/)]),
    );
  });
});

describe('0002_add_surface_column migration', () => {
  it('introduces the per-surface device bucket via ALTER TABLE', () => {
    expect(migrationSqlSurface).toMatch(/ALTER TABLE devices/i);
    expect(migrationSqlSurface).toContain("'desktop'");
    expect(migrationSqlSurface).toContain("'web'");
    expect(migrationSqlSurface).toMatch(/CHECK\s*\(\s*surface IN/i);
  });

  it('adds the per-surface composite index used by the activate-bucket count', () => {
    expect(migrationSqlSurface).toMatch(/devices_license_surface_active_idx/);
  });
});

describe('0001_initial migration', () => {
  it('constrains license product ids and tiers, including server-minted tiers', () => {
    expect(migrationSql).toContain("'lingua_trial'");
    expect(migrationSql).toContain("'lingua_education'");
    expect(migrationSql).toMatch(/product_id\s+TEXT NOT NULL CHECK/s);
    expect(migrationSql).toMatch(/tier\s+TEXT NOT NULL CHECK/s);
  });

  it('constrains license status values so future handlers cannot persist unknown states', () => {
    expect(migrationSql).toMatch(/status\s+TEXT NOT NULL CHECK/s);
    expect(migrationSql).toContain("'cancel_at_period_end'");
  });

  it('originally constrained device OS to the desktop triple (relaxed in 0003)', () => {
    // 0001 shipped with a desktop-only enum that implementation's web
    // activate path could not satisfy. 0003 rebuilds the table
    // without the CHECK so the request-side validator
    // (validation.ts:validateOsField) becomes the single bound. This
    // assertion stays so the historical 0001 shape is documented;
    // see the matching `0003 ...` block below for the relaxed shape.
    expect(migrationSql).toContain("os              TEXT NOT NULL CHECK (os IN ('darwin', 'win32', 'linux'))");
  });
});

describe('0003_relax_devices_os_check migration', () => {
  it('rebuilds the devices table without the os enum CHECK so web-* values can land', async () => {
    const migration = (await import('../migrations/0003_relax_devices_os_check.sql?raw')).default;
    expect(migration).toContain('CREATE TABLE devices_new');
    // Strip SQL comments before scanning so the (intentional) prose
    // about the OLD constraint in the header doesn't false-positive.
    const sqlOnly = migration
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sqlOnly).toContain('os              TEXT NOT NULL,');
    expect(sqlOnly).not.toContain("CHECK (os IN ('darwin', 'win32', 'linux'))");
    // Indexes from 0001 + 0002 are recreated against the renamed table.
    expect(sqlOnly).toContain('devices_license_active_idx');
    expect(sqlOnly).toContain('devices_license_surface_active_idx');
    // Surface CHECK survives — only the os enum was relaxed.
    expect(sqlOnly).toContain("CHECK (surface IN ('desktop', 'web'))");
  });
});

describe('0004_add_educations_and_pending_tables migration', () => {
  it('declares educations + 2 pending tables with the right anti-abuse shape', async () => {
    const migration = (
      await import('../migrations/0004_add_educations_and_pending_tables.sql?raw')
    ).default;
    // Strip SQL comments before scanning so prose in the header
    // doesn't false-positive against the assertions.
    const sqlOnly = migration
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // educations: same shape as trials with UNIQUE(email) +
    // UNIQUE(device_id) so the magic-link confirm path bounces
    // duplicates at the storage layer instead of relying on the
    // handler pre-check alone. The constraints are declared
    // table-level (not inline on the column) — same form as the
    // 0001 trials block.
    expect(sqlOnly).toMatch(/CREATE TABLE IF NOT EXISTS educations/i);
    const educationsBlockMatch = sqlOnly.match(
      /CREATE TABLE IF NOT EXISTS educations[\s\S]*?\);/i
    );
    expect(educationsBlockMatch).not.toBeNull();
    const educationsBlock = educationsBlockMatch![0];
    expect(educationsBlock).toMatch(/UNIQUE\s*\(\s*email\s*\)/i);
    expect(educationsBlock).toMatch(/UNIQUE\s*\(\s*device_id\s*\)/i);

    // education pending: 24h TTL via expires_at, idempotent confirm
    // via nullable confirmed_at.
    expect(sqlOnly).toMatch(
      /CREATE TABLE IF NOT EXISTS education_pending_confirmations/i
    );
    expect(sqlOnly).toMatch(/confirmed_at\s+INTEGER/i);

    // recovery pending: NO device columns (recovery does not
    // register a new device).
    expect(sqlOnly).toMatch(
      /CREATE TABLE IF NOT EXISTS recovery_pending_confirmations/i
    );
    // Quick negative — the recovery pending block must not
    // accidentally inherit device_id / device_name / os.
    const recoveryBlockMatch = sqlOnly.match(
      /CREATE TABLE IF NOT EXISTS recovery_pending_confirmations[\s\S]*?\);/i
    );
    expect(recoveryBlockMatch).not.toBeNull();
    const recoveryBlock = recoveryBlockMatch![0];
    expect(recoveryBlock).not.toMatch(/device_id/i);
    expect(recoveryBlock).not.toMatch(/device_name/i);
  });
});

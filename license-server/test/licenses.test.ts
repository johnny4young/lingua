/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import migrationSql from '../migrations/0001_initial.sql?raw';
import migrationSqlSurface from '../migrations/0002_add_surface_column.sql?raw';
import app from '../src/index';
import { signLicenseToken, type LicensePayload } from '../src/lib/sign';
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

  it('rejects an unknown OS', async () => {
    const response = await postJson('/licenses/activate', { ...ACTIVATE_BODY, os: 'plan9' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^os must be one of/)]));
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

  it('rejects an oversized token so an attacker cannot force the verifier to allocate megabytes before rejecting in Slice 2', async () => {
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
    const issuedAt = 1_700_000_000;
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

  it('constrains device operating systems to the validated request enum', () => {
    expect(migrationSql).toContain("os              TEXT NOT NULL CHECK (os IN ('darwin', 'win32', 'linux'))");
  });
});

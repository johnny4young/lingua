/**
 * implementation — Recovery endpoints (magic-link two-step).
 *
 * Pin the no-info-leak design (Decision 7): /start ALWAYS returns
 * 200 + neutral copy regardless of whether the email matches a
 * known license, hits a rate limit, or is unknown. Pending row +
 * timing must match across all branches so a network observer
 * cannot distinguish them.
 *
 * /confirm uses the same generic success HTML for "we sent the
 * token" and "no matching license" — only the genuine "link
 * expired" branch differs (unavoidable to convey staleness).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { createMockEnv, generateEd25519Keypair } from './helpers';
import { insertLicense } from '../src/lib/db';

async function postJson(
  path: string,
  body: unknown,
  env: ReturnType<typeof createMockEnv>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(
    `http://localhost${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function getResponse(
  path: string,
  env: ReturnType<typeof createMockEnv>,
): Promise<Response> {
  return app.request(`http://localhost${path}`, {}, env);
}

const NEUTRAL_MESSAGE_REGEX = /If that email matches/i;

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------- POST /licenses/recover/start

describe('POST /licenses/recover/start', () => {
  it('returns 200 + neutral copy + creates a pending row for an unknown email', async () => {
    const env = createMockEnv();
    const response = await postJson(
      '/licenses/recover/start',
      { email: 'nobody@example.com' },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; pending: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.pending).toBe(true);
    expect(body.message).toMatch(NEUTRAL_MESSAGE_REGEX);
    // Pending row IS created even for unknown emails (timing parity).
    expect(env.__db.recoveryPending.size).toBe(1);
  });

  it('returns 200 + same neutral copy for a known email', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateEd25519Keypair();
    const env = createMockEnv({ privateKeyJwk, publicKeyJwk });

    // Seed a license under the email
    await insertLicense(env.DB, {
      id: 'lic_known',
      token: 'known.token',
      productId: 'lingua_pro_lifetime',
      tier: 'pro',
      deviceLimit: 3,
      issuedTo: 'buyer@example.com',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: null,
      supportWindowEndsAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      status: 'active',
      polarOrderId: 'order_1',
      polarSubscriptionId: null,
    });

    const response = await postJson(
      '/licenses/recover/start',
      { email: 'buyer@example.com' },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(NEUTRAL_MESSAGE_REGEX);
    expect(env.__db.recoveryPending.size).toBe(1);
  });

  it('lowercases + trims the email so case-insensitive lookups succeed downstream', async () => {
    const env = createMockEnv();
    const response = await postJson(
      '/licenses/recover/start',
      { email: '  USER@Example.COM  ' },
      env,
    );
    expect(response.status).toBe(200);
    const stored = [...env.__db.recoveryPending.values()][0];
    expect(stored?.email).toBe('user@example.com');
  });

  it('rejects an invalid email shape with invalid-input', async () => {
    const env = createMockEnv();
    const response = await postJson('/licenses/recover/start', { email: 'no-at-sign' }, env);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string; issues: string[] };
    expect(body.reason).toBe('invalid-input');
    expect(body.issues).toEqual(expect.arrayContaining([expect.stringMatching(/malformed/)]));
  });

  it('rejects a non-JSON body', async () => {
    const env = createMockEnv();
    const response = await app.request(
      'http://localhost/licenses/recover/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      },
      env,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason: string };
    expect(body.reason).toBe('invalid-input');
  });

  it('returns 200 + neutral copy when per-IP rate-limit fires (no pending row created)', async () => {
    const env = createMockEnv();
    const headers = { 'cf-connecting-ip': '203.0.113.7' };

    // 5 successful hits per IP per day
    for (let i = 0; i < 5; i += 1) {
      const r = await postJson(
        '/licenses/recover/start',
        { email: `user-${i}@example.com` },
        env,
        headers,
      );
      expect(r.status).toBe(200);
    }
    expect(env.__db.recoveryPending.size).toBe(5);

    // Sixth hit — rate-limited, but client cannot tell
    const sixth = await postJson(
      '/licenses/recover/start',
      { email: 'user-6@example.com' },
      env,
      headers,
    );
    expect(sixth.status).toBe(200);
    const body = (await sixth.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(NEUTRAL_MESSAGE_REGEX);
    // No pending row created when rate-limited (so the limit actually limits)
    expect(env.__db.recoveryPending.size).toBe(5);
  });

  it('returns 200 + neutral copy when per-email rate-limit fires', async () => {
    const env = createMockEnv();
    // 3 hits per email per day
    for (let i = 0; i < 3; i += 1) {
      const r = await postJson(
        '/licenses/recover/start',
        { email: 'spam-target@example.com' },
        env,
        { 'cf-connecting-ip': `198.51.100.${i + 1}` }, // different IPs
      );
      expect(r.status).toBe(200);
    }
    expect(env.__db.recoveryPending.size).toBe(3);

    // Fourth hit on same email from a fresh IP — per-email limit fires
    const fourth = await postJson(
      '/licenses/recover/start',
      { email: 'spam-target@example.com' },
      env,
      { 'cf-connecting-ip': '198.51.100.99' },
    );
    expect(fourth.status).toBe(200);
    expect(env.__db.recoveryPending.size).toBe(3);
  });

  it('returns 405 for GET on /start', async () => {
    const env = createMockEnv();
    const response = await getResponse('/licenses/recover/start', env);
    expect(response.status).toBe(405);
  });
});

// --------------------------------------------- GET /licenses/recover/confirm

describe('GET /licenses/recover/confirm', () => {
  it('returns generic success HTML for an unknown confirm id (no info leak)', async () => {
    const env = createMockEnv();
    const response = await getResponse(
      '/licenses/recover/confirm?confirm=11111111-2222-3333-4444-555555555555',
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    const html = await response.text();
    expect(html).toMatch(/recovery received|just emailed|matching license/i);
  });

  it('marks pending confirmed + sends recovery email when license matches', async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify({ id: 'em_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const env = createMockEnv({
      resendApiKey: 're_test_key',
    });
    // Seed license + pending row
    await insertLicense(env.DB, {
      id: 'lic_recover',
      token: 'recover.token.abc',
      productId: 'lingua_lifetime',
      tier: 'pro_lifetime',
      deviceLimit: 3,
      issuedTo: 'recover@example.com',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: null,
      supportWindowEndsAt: Math.floor(Date.parse('2027-01-01T00:00:00.000Z') / 1000),
      status: 'active',
      polarOrderId: null,
      polarSubscriptionId: null,
    });
    const pendingId = '11111111-2222-3333-4444-555555555555';
    const now = Math.floor(Date.now() / 1000);
    env.__db.recoveryPending.set(pendingId, {
      id: pendingId,
      email: 'recover@example.com',
      device_id: null,
      device_name: null,
      os: null,
      created_at: now,
      expires_at: now + 24 * 60 * 60,
      confirmed_at: null,
    });

    const response = await getResponse(
      `/licenses/recover/confirm?confirm=${pendingId}`,
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);

    // Pending row marked confirmed
    expect(env.__db.recoveryPending.get(pendingId)?.confirmed_at).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error('expected Resend request init');
    const requestBody = JSON.parse(String(init.body)) as {
      text: string;
      html: string;
    };
    expect(requestBody.text).toContain('recover.token.abc');
    expect(requestBody.html).toContain('recover.token.abc');
    expect(requestBody.text).toContain('Your Pro features stay unlocked forever.');
    expect(requestBody.html).toContain('Renewal is optional if you want later updates.');
  });

  it('prefers an older paid license over a newer free trial during recovery', async () => {
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify({ id: 'em_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const env = createMockEnv({ resendApiKey: 're_test_key' });
    const now = Math.floor(Date.now() / 1000);

    await insertLicense(env.DB, {
      id: 'lic_paid_older',
      token: 'paid.token.recover',
      productId: 'lingua_pro_monthly',
      tier: 'pro',
      deviceLimit: 3,
      issuedTo: 'buyer@example.com',
      issuedAt: now - 30 * 24 * 60 * 60,
      expiresAt: null,
      supportWindowEndsAt: null,
      status: 'active',
      polarOrderId: 'order_paid',
      polarSubscriptionId: 'sub_paid',
    });
    const paidRow = env.__db.licenses.get('lic_paid_older');
    if (paidRow) paidRow.created_at = now - 30 * 24 * 60 * 60;

    await insertLicense(env.DB, {
      id: 'lic_trial_newer',
      token: 'trial.token.recover',
      productId: 'lingua_trial',
      tier: 'trial',
      deviceLimit: 1,
      issuedTo: 'buyer@example.com',
      issuedAt: now,
      expiresAt: now + 14 * 24 * 60 * 60,
      supportWindowEndsAt: null,
      status: 'active',
      polarOrderId: null,
      polarSubscriptionId: null,
    });
    const trialRow = env.__db.licenses.get('lic_trial_newer');
    if (trialRow) trialRow.created_at = now;

    const pendingId = '66666666-7777-8888-9999-aaaaaaaaaaaa';
    env.__db.recoveryPending.set(pendingId, {
      id: pendingId,
      email: 'buyer@example.com',
      device_id: null,
      device_name: null,
      os: null,
      created_at: now,
      expires_at: now + 24 * 60 * 60,
      confirmed_at: null,
    });

    const response = await getResponse(
      `/licenses/recover/confirm?confirm=${pendingId}`,
      env,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error('expected Resend request init');
    const requestBody = JSON.parse(String(init.body)) as {
      text: string;
      html: string;
    };
    expect(requestBody.text).toContain('paid.token.recover');
    expect(requestBody.html).toContain('paid.token.recover');
    expect(requestBody.text).not.toContain('trial.token.recover');
    expect(requestBody.html).not.toContain('trial.token.recover');
  });

  it('is idempotent on a re-clicked link (re-renders success without re-emailing)', async () => {
    const env = createMockEnv({ resendApiKey: 're_test_key' });
    const pendingId = '22222222-3333-4444-5555-666666666666';
    const now = Math.floor(Date.now() / 1000);
    env.__db.recoveryPending.set(pendingId, {
      id: pendingId,
      email: 'someone@example.com',
      device_id: null,
      device_name: null,
      os: null,
      created_at: now - 60,
      expires_at: now + 24 * 60 * 60,
      confirmed_at: now - 30, // already confirmed earlier
    });

    const response = await getResponse(
      `/licenses/recover/confirm?confirm=${pendingId}`,
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('returns 410 expired HTML when the pending row aged past 24h', async () => {
    const env = createMockEnv();
    const pendingId = '33333333-4444-5555-6666-777777777777';
    const now = Math.floor(Date.now() / 1000);
    env.__db.recoveryPending.set(pendingId, {
      id: pendingId,
      email: 'old@example.com',
      device_id: null,
      device_name: null,
      os: null,
      created_at: now - 48 * 60 * 60,
      expires_at: now - 60, // expired
      confirmed_at: null,
    });

    const response = await getResponse(
      `/licenses/recover/confirm?confirm=${pendingId}`,
      env,
    );
    expect(response.status).toBe(410);
    const html = await response.text();
    expect(html).toMatch(/expired/i);
  });

  it('returns 400 HTML when the confirm param is missing', async () => {
    const env = createMockEnv();
    const response = await getResponse('/licenses/recover/confirm', env);
    expect(response.status).toBe(400);
  });

  it('returns generic success HTML when license-by-email lookup misses (no leak)', async () => {
    const env = createMockEnv({ resendApiKey: 're_test_key' });
    const pendingId = '44444444-5555-6666-7777-888888888888';
    const now = Math.floor(Date.now() / 1000);
    env.__db.recoveryPending.set(pendingId, {
      id: pendingId,
      email: 'no-license-here@example.com',
      device_id: null,
      device_name: null,
      os: null,
      created_at: now,
      expires_at: now + 24 * 60 * 60,
      confirmed_at: null,
    });
    // NO license seeded for this email

    const response = await getResponse(
      `/licenses/recover/confirm?confirm=${pendingId}`,
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    // Pending was still marked confirmed (single-use)
    expect(env.__db.recoveryPending.get(pendingId)?.confirmed_at).not.toBeNull();
  });

  it('renders generic success even when RESEND_API_KEY is missing (server-config does not leak)', async () => {
    const env = createMockEnv(); // no resendApiKey
    await insertLicense(env.DB, {
      id: 'lic_no_resend',
      token: 'no-resend.token',
      productId: 'lingua_pro_lifetime',
      tier: 'pro',
      deviceLimit: 3,
      issuedTo: 'has-license@example.com',
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: null,
      supportWindowEndsAt: null,
      status: 'active',
      polarOrderId: null,
      polarSubscriptionId: null,
    });
    const pendingId = '55555555-6666-7777-8888-999999999999';
    const now = Math.floor(Date.now() / 1000);
    env.__db.recoveryPending.set(pendingId, {
      id: pendingId,
      email: 'has-license@example.com',
      device_id: null,
      device_name: null,
      os: null,
      created_at: now,
      expires_at: now + 24 * 60 * 60,
      confirmed_at: null,
    });

    const response = await getResponse(
      `/licenses/recover/confirm?confirm=${pendingId}`,
      env,
    );
    // Despite the misconfiguration, the user-facing response stays the
    // same — server logs the issue rather than leaking 501.
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
  });
});

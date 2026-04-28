import { describe, expect, it } from 'vitest';
import app, { buildInternalErrorResponse } from '../src/index';
import { buildSignedPolarWebhook, createMockEnv, generateEd25519Keypair } from './helpers';

const WHSEC = 'whsec_dGVzdC1zZWNyZXQ=';

describe('POST /webhooks/polar', () => {
  it('returns 501 not-implemented when POLAR_WEBHOOK_SECRET is not configured (defends against accidentally accepting events on a half-deployed worker)', async () => {
    const response = await app.request(
      'http://localhost/webhooks/polar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'order.paid', data: { id: 'fake' } }),
      },
      createMockEnv({ polarWebhookSecret: '' })
    );
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body).toMatchObject({ ok: false, reason: 'not-implemented' });
    expect(body.message).toMatch(/POLAR_WEBHOOK_SECRET/);
  });

  it('returns 401 invalid-signature when headers are missing the signature triple', async () => {
    const response = await app.request(
      'http://localhost/webhooks/polar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      },
      createMockEnv({ polarWebhookSecret: 'whsec_dGVzdC1zZWNyZXQ=' })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'missing-headers' });
  });

  it('returns 405 for method mismatches on the known webhook route', async () => {
    const response = await app.request('http://localhost/webhooks/polar');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'method-not-allowed' });
  });

  it('waits for order.paid before minting a subscription license', async () => {
    const env = createMockEnv({ polarWebhookSecret: WHSEC });
    const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
      type: 'subscription.created',
      data: {
        id: 'sub_pending',
        customer: { email: 'buyer@example.com' },
        product: { id: 'lingua_monthly', metadata: {} },
        current_period_end: '2026-05-27T00:00:00.000Z',
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/polar',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'awaiting-order-paid' });
    expect(env.__db.licenses.size).toBe(0);
  });

  it('mints an expiring Team license from the paid subscription order', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      polarWebhookSecret: WHSEC,
      privateKeyJwk: keys.privateKeyJwk,
    });
    const { headers, body } = await buildSignedPolarWebhook(WHSEC, {
      type: 'order.paid',
      data: {
        id: 'order_team_paid',
        billing_reason: 'subscription_create',
        subscription_id: 'sub_team',
        customer: { email: 'buyer@example.com' },
        product: { id: 'lingua_team', metadata: { device_limit: '10' } },
        subscription: { id: 'sub_team', current_period_end: '2026-05-27T00:00:00.000Z' },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/polar',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; licenseId?: string };
    expect(parsed.ok).toBe(true);
    expect(env.__db.licenses.size).toBe(1);
    const [row] = [...env.__db.licenses.values()];
    expect(row).toMatchObject({
      product_id: 'lingua_team',
      tier: 'team',
      issued_to: 'buyer@example.com',
      polar_order_id: null,
      polar_subscription_id: 'sub_team',
      device_limit: 10,
      expires_at: Math.floor(Date.parse('2026-05-27T00:00:00.000Z') / 1000),
    });
  });
});

describe('Unknown routes', () => {
  it('returns 404 not-found with the tagged-union shape for paths that match no router prefix', async () => {
    const response = await app.request('http://localhost/random/unknown/path');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body).toMatchObject({ ok: false, reason: 'not-found' });
    expect(body.message).toMatch(/unknown route/);
  });

  it('returns the same JSON 404 shape for unknown sub-router paths (Hono does not bubble sub-router 404s back to the parent)', async () => {
    // /licenses/* is a known prefix but /licenses/nonexistent is not a
    // registered sub-route. Without a per-router notFound override, Hono
    // would return its default plain-text 404 here and break the IPC
    // contract callers depend on.
    const subRouterPaths = [
      'http://localhost/licenses/nonexistent',
      'http://localhost/trials/nonexistent',
      'http://localhost/webhooks/nonexistent',
      'http://localhost/health/nonexistent',
    ];
    for (const url of subRouterPaths) {
      const response = await app.request(url);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
      const body = (await response.json()) as { ok: boolean; reason: string };
      expect(body).toMatchObject({ ok: false, reason: 'not-found' });
    }
  });

  it('attaches the no-store cache header on 404 too so a stale CDN never masks routing changes', async () => {
    const response = await app.request('http://localhost/random/unknown/path');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('Unhandled errors (buildInternalErrorResponse)', () => {
  it('returns the tagged-union internal-error shape with no-store cache + no leaked detail', async () => {
    // The shared Hono `app` instance can't accept new routes once the
    // SmartRouter is frozen on first request. Tests the helper that
    // app.onError dispatches into so the contract regression is still
    // caught if Slice 2 reshapes the wrapper.
    const { Hono } = await import('hono');
    const probe = new Hono();
    probe.get('/probe', (c) => buildInternalErrorResponse(c));
    const response = await probe.request('http://localhost/probe');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('internal-error');
    // Generic message — never echoes thrown errors that could leak
    // internals (filenames, env values, stack traces) back to callers.
    expect(body.message).toBe('Unexpected server error.');
  });
});

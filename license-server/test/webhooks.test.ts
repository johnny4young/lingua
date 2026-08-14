import { afterEach, describe, expect, it, vi } from 'vitest';
import app, { buildInternalErrorResponse } from '../src/index';
import { PRO_LIFETIME_INCLUDED_UPDATES_SECONDS } from '../src/handlers/webhooks';
import { buildSignedLemonSqueezyWebhook, createMockEnv, generateEd25519Keypair } from './helpers';

const SECRET = 'test-signing-secret';

// createMockEnv defaults: LS_VARIANT_MONTHLY=111, LS_VARIANT_LIFETIME=222,
// LS_VARIANT_TEAM=333. Fixture shapes mirror Lemon Squeezy's JSON:API
// payloads: meta.event_name + data.{type,id,attributes}.

describe('POST /webhooks/lemonsqueezy', () => {
  // A failing expect must not leak a stubbed global fetch into later tests.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 501 not-implemented when LS_WEBHOOK_SECRET is not configured (defends against accidentally accepting events on a half-deployed worker)', async () => {
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meta: { event_name: 'order_created' }, data: { id: 'fake' } }),
      },
      createMockEnv({ lsWebhookSecret: '' })
    );
    expect(response.status).toBe(501);
    const body = (await response.json()) as { ok: boolean; reason: string; message?: string };
    expect(body).toMatchObject({ ok: false, reason: 'not-implemented' });
    expect(body.message).toMatch(/LS_WEBHOOK_SECRET/);
  });

  it('returns 400 missing-headers when X-Signature is absent', async () => {
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      },
      createMockEnv({ lsWebhookSecret: SECRET })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'missing-headers' });
  });

  it('returns 401 invalid-signature when the body was signed with a different secret', async () => {
    const { headers, body } = await buildSignedLemonSqueezyWebhook('wrong-secret', {
      meta: { event_name: 'order_created' },
      data: { type: 'orders', id: '1', attributes: {} },
    });
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      createMockEnv({ lsWebhookSecret: SECRET })
    );
    expect(response.status).toBe(401);
    const parsed = (await response.json()) as { ok: boolean; reason: string };
    expect(parsed).toMatchObject({ ok: false, reason: 'invalid-signature' });
  });

  it('returns 405 for method mismatches on the known webhook route', async () => {
    const response = await app.request('http://localhost/webhooks/lemonsqueezy');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body).toMatchObject({ ok: false, reason: 'method-not-allowed' });
  });

  it('acks the subscription order and waits for subscription_created to mint (the LS subscription carries renews_at, not the order)', async () => {
    const env = createMockEnv({ lsWebhookSecret: SECRET });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '5001',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          status: 'paid',
          first_order_item: { product_id: 90, variant_id: 111 },
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'awaiting-subscription-created' });
    expect(env.__db.licenses.size).toBe(0);
  });

  it('mints an expiring Team license from subscription_created, storing BOTH merchant ids so a later order_refunded can revoke it — and takes the device limit from maintainer env, IGNORING buyer custom data', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
      lsTeamDeviceLimit: '10',
    });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      // custom_data is buyer-controlled checkout input; 999 here proves
      // it cannot escalate the seat count.
      meta: { event_name: 'subscription_created', custom_data: { device_limit: '999' } },
      data: {
        type: 'subscriptions',
        id: 'sub_team',
        attributes: {
          store_id: 7,
          order_id: 6001,
          product_id: 91,
          variant_id: 333,
          user_email: 'buyer@example.com',
          status: 'active',
          renews_at: '2026-05-27T00:00:00.000Z',
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
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
      merchant_order_id: '6001',
      merchant_subscription_id: 'sub_team',
      device_limit: 10,
      expires_at: Math.floor(Date.parse('2026-05-27T00:00:00.000Z') / 1000),
    });
  });

  it('mints Pro Lifetime from order_created with perpetual entitlement and a one-year included-update window', async () => {
    const keys = await generateEd25519Keypair();
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(JSON.stringify({ id: 'email_lifetime' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
      resendApiKey: 're_test_key',
    });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '7001',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          status: 'paid',
          first_order_item: { product_id: 92, variant_id: 222 },
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const [row] = [...env.__db.licenses.values()];
    expect(row).toMatchObject({
      product_id: 'lingua_lifetime',
      tier: 'pro_lifetime',
      expires_at: null,
      merchant_order_id: '7001',
    });
    expect(row?.support_window_ends_at).toBe(
      row!.issued_at + PRO_LIFETIME_INCLUDED_UPDATES_SECONDS
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      html: string;
      text: string;
    };
    expect(requestBody.text).toContain('Your Pro features stay unlocked forever.');
    expect(requestBody.text).toContain('Renewal is optional if you want later updates.');
    expect(requestBody.html).toContain('Included updates and priority email support run through');
  });

  it('replays of the same lifetime order ack `duplicate` without a second mint or email', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
    });
    const webhook = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '7002',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          first_order_item: { variant_id: 222 },
        },
      },
    });

    const first = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: webhook.headers, body: webhook.body },
      env
    );
    expect(first.status).toBe(200);
    expect(env.__db.licenses.size).toBe(1);

    // Same signed bytes, delivered again — the LS replay scheme has no
    // timestamp, so THIS is the entire replay defense.
    const replayed = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '7002',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          first_order_item: { variant_id: 222 },
        },
      },
    });
    const second = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: replayed.headers, body: replayed.body },
      env
    );
    expect(second.status).toBe(200);
    const parsed = (await second.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'duplicate' });
    expect(env.__db.licenses.size).toBe(1);
  });

  it('refreshes the token when subscription_updated advances renews_at past the stored expiry (the LS renewal path)', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
    });
    const created = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_created' },
      data: {
        type: 'subscriptions',
        id: 'sub_renew',
        attributes: {
          store_id: 7,
          order_id: 6002,
          variant_id: 111,
          user_email: 'buyer@example.com',
          renews_at: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: created.headers, body: created.body },
      env
    );
    const [beforeRow] = [...env.__db.licenses.values()];
    const tokenBefore = beforeRow!.token;

    const renewed = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_updated' },
      data: {
        type: 'subscriptions',
        id: 'sub_renew',
        attributes: {
          store_id: 7,
          variant_id: 111,
          user_email: 'buyer@example.com',
          status: 'active',
          cancelled: false,
          renews_at: '2026-10-13T00:00:00.000Z',
        },
      },
    });
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: renewed.headers, body: renewed.body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; refreshedTokenIssued?: boolean };
    expect(parsed).toMatchObject({ ok: true, refreshedTokenIssued: true });
    const [afterRow] = [...env.__db.licenses.values()];
    expect(afterRow!.token).not.toBe(tokenBefore);
    expect(afterRow!.expires_at).toBe(Math.floor(Date.parse('2026-10-13T00:00:00.000Z') / 1000));
  });

  it('acks `unknown-product` for a sibling product variant in the SHARED store — a valid vitrine/gancho purchase must never mint a Lingua license', async () => {
    const env = createMockEnv({ lsWebhookSecret: SECRET });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '8001',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          status: 'paid',
          first_order_item: { product_id: 555, variant_id: 987654 },
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as {
      ok: boolean;
      ignored?: string;
      variantId?: number | null;
    };
    expect(parsed).toMatchObject({ ok: true, ignored: 'unknown-product', variantId: 987654 });
    expect(env.__db.licenses.size).toBe(0);
  });

  it('acks `unknown-product` for EVERY event while the variant vars are unset — the safe half-configured deploy', async () => {
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      lsVariantMonthly: '',
      lsVariantLifetime: '',
      lsVariantTeam: '',
    });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '8002',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          first_order_item: { variant_id: 222 },
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    // LS_STORE_ID is also unset here, so the store gate passes and the
    // variant gate is what rejects — deterministically unknown-product.
    expect(parsed).toMatchObject({ ok: true, ignored: 'unknown-product' });
    expect(env.__db.licenses.size).toBe(0);
  });

  it('acks `unknown-store` when LS_STORE_ID is set and the event came from a foreign store', async () => {
    const env = createMockEnv({ lsWebhookSecret: SECRET, lsStoreId: '7' });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '8003',
        attributes: {
          store_id: 99,
          user_email: 'buyer@example.com',
          first_order_item: { variant_id: 222 },
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'unknown-store' });
    expect(env.__db.licenses.size).toBe(0);
  });

  it('revokes a subscription license via order_refunded using the order id captured at subscription_created', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
    });
    const created = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_created' },
      data: {
        type: 'subscriptions',
        id: 'sub_refund',
        attributes: {
          store_id: 7,
          order_id: 6100,
          variant_id: 111,
          user_email: 'buyer@example.com',
          renews_at: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: created.headers, body: created.body },
      env
    );
    expect(env.__db.licenses.size).toBe(1);

    const refunded = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_refunded' },
      data: { type: 'orders', id: '6100', attributes: { store_id: 7, refunded: true } },
    });
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: refunded.headers, body: refunded.body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; status?: string };
    expect(parsed).toMatchObject({ ok: true, status: 'refunded' });
    const [row] = [...env.__db.licenses.values()];
    expect(row!.status).toBe('refunded');
  });

  it('acks subscription_payment_success for an unknown subscription without minting (first invoice can beat subscription_created)', async () => {
    const env = createMockEnv({ lsWebhookSecret: SECRET });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_payment_success' },
      data: {
        type: 'subscription-invoices',
        id: '4001',
        attributes: { store_id: 7, subscription_id: 424242, billing_reason: 'initial' },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'unknown-subscription' });
    expect(env.__db.licenses.size).toBe(0);
  });

  it('acks subscription_payment_success without LS_API_KEY and relies on subscription_updated for the refresh', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
    });
    const created = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_created' },
      data: {
        type: 'subscriptions',
        id: 'sub_invoice_nokey',
        attributes: {
          store_id: 7,
          order_id: 6200,
          variant_id: 111,
          user_email: 'buyer@example.com',
          renews_at: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: created.headers, body: created.body },
      env
    );

    const invoice = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_payment_success' },
      data: {
        type: 'subscription-invoices',
        id: '4002',
        attributes: { store_id: 7, subscription_id: 'sub_invoice_nokey', billing_reason: 'renewal' },
      },
    });
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: invoice.headers, body: invoice.body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'awaiting-subscription-updated' });
  });

  it('refreshes from the LS API on subscription_payment_success when LS_API_KEY is configured — the authoritative renewal fallback', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
      lsApiKey: 'lsk_test',
    });
    const created = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_created' },
      data: {
        type: 'subscriptions',
        id: 'sub_invoice_renew',
        attributes: {
          store_id: 7,
          order_id: 6300,
          variant_id: 111,
          user_email: 'buyer@example.com',
          renews_at: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: created.headers, body: created.body },
      env
    );
    const [beforeRow] = [...env.__db.licenses.values()];
    const tokenBefore = beforeRow!.token;

    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        expect(String(input)).toContain('/v1/subscriptions/sub_invoice_renew');
        return new Response(
          JSON.stringify({
            data: { attributes: { renews_at: '2026-10-13T00:00:00.000Z' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const invoice = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_payment_success' },
      data: {
        type: 'subscription-invoices',
        id: '4003',
        attributes: { store_id: 7, subscription_id: 'sub_invoice_renew', billing_reason: 'renewal' },
      },
    });
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: invoice.headers, body: invoice.body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; refreshedTokenIssued?: boolean };
    expect(parsed).toMatchObject({
      ok: true,
      refreshedTokenIssued: true,
      source: 'subscription_payment_success',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [afterRow] = [...env.__db.licenses.values()];
    expect(afterRow!.token).not.toBe(tokenBefore);
    expect(afterRow!.expires_at).toBe(Math.floor(Date.parse('2026-10-13T00:00:00.000Z') / 1000));
  });

  it('does NOT resurrect a refunded license when a late subscription_updated arrives with a newer renews_at', async () => {
    const keys = await generateEd25519Keypair();
    const env = createMockEnv({
      lsWebhookSecret: SECRET,
      privateKeyJwk: keys.privateKeyJwk,
    });
    const created = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_created' },
      data: {
        type: 'subscriptions',
        id: 'sub_zombie',
        attributes: {
          store_id: 7,
          order_id: 6400,
          variant_id: 111,
          user_email: 'buyer@example.com',
          renews_at: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: created.headers, body: created.body },
      env
    );
    const refunded = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_refunded' },
      data: { type: 'orders', id: '6400', attributes: { store_id: 7, refunded: true } },
    });
    await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: refunded.headers, body: refunded.body },
      env
    );
    const [row] = [...env.__db.licenses.values()];
    const tokenAfterRefund = row!.token;
    expect(row!.status).toBe('refunded');

    // The zombie: a replayed/late update with an advanced renews_at.
    const zombie = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'subscription_updated' },
      data: {
        type: 'subscriptions',
        id: 'sub_zombie',
        attributes: {
          store_id: 7,
          variant_id: 111,
          user_email: 'buyer@example.com',
          status: 'active',
          cancelled: false,
          renews_at: '2026-12-13T00:00:00.000Z',
        },
      },
    });
    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers: zombie.headers, body: zombie.body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'refunded' });
    const [after] = [...env.__db.licenses.values()];
    expect(after!.status).toBe('refunded');
    expect(after!.token).toBe(tokenAfterRefund);
  });

  it('refuses to mint from an order_created that Lemon Squeezy already reports as refunded', async () => {
    const env = createMockEnv({ lsWebhookSecret: SECRET });
    const { headers, body } = await buildSignedLemonSqueezyWebhook(SECRET, {
      meta: { event_name: 'order_created' },
      data: {
        type: 'orders',
        id: '9001',
        attributes: {
          store_id: 7,
          user_email: 'buyer@example.com',
          status: 'refunded',
          refunded: true,
          first_order_item: { variant_id: 222 },
        },
      },
    });

    const response = await app.request(
      'http://localhost/webhooks/lemonsqueezy',
      { method: 'POST', headers, body },
      env
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ok: boolean; ignored?: string };
    expect(parsed).toMatchObject({ ok: true, ignored: 'order-already-refunded' });
    expect(env.__db.licenses.size).toBe(0);
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
    // caught if a later change reshapes the wrapper.
    const { Hono } = await import('hono');
    const probe = new Hono();
    probe.get('/probe', c => buildInternalErrorResponse(c));
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

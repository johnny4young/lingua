/**
 * Lemon Squeezy webhook handler.
 *
 * Verifies the Lemon Squeezy `X-Signature` HMAC, dispatches the event
 * to a D1-backed handler, mints a fresh license token where applicable,
 * and emits an email via Resend.
 *
 * Event flow differs from the Polar era in one structural way: Polar's
 * paid ORDER carried the subscription period, so subscription licenses
 * minted on `order.paid`. Lemon Squeezy inverts the reference — the
 * SUBSCRIPTION carries `order_id` + `renews_at`, while the order only
 * knows its variant. Subscription licenses therefore mint on
 * `subscription_created`, and renewals refresh on `subscription_updated`
 * when `renews_at` advances past the stored `expires_at`.
 *
 * Idempotency contract (unchanged in spirit):
 *   - `merchant_order_id` lookup — a duplicate `order_created` for the
 *     same lifetime order returns `{ ok: true, ignored: 'duplicate' }`
 *     without re-issuing the email.
 *   - `merchant_subscription_id` lookup — same for a replayed
 *     `subscription_created`.
 *   - Subscription rows store BOTH ids (`subscription_created` carries
 *     `order_id`), so an `order_refunded` for the originating order
 *     revokes subscription licenses too.
 *   - Unknown event names ack 200 with `ignored: 'unknown-event'` so a
 *     misconfigured webhook surface is loud in observability without
 *     triggering Lemon Squeezy's three-day retry storm.
 *
 * Shared-store defense: the LS store also sells the maintainer's other
 * products. Every mint path resolves the event's variant id against the
 * configured Lingua variants first; an event for a sibling product acks
 * `unknown-product` and never mints. `LS_STORE_ID`, when set, rejects
 * events from foreign stores before variant resolution even runs.
 */

import { Hono, type Context } from 'hono';
import { errorResponse, methodNotAllowedResponse } from '../lib/errors';
import { jsonNoStore } from '../lib/json';
import {
  deviceLimitForProduct,
  orderAttributes,
  resolveVariantSku,
  storeMatches,
  subscriptionAttributes,
  verifyLemonSqueezyWebhook,
  type LemonSqueezyEvent,
  type LinguaProductId,
} from '../lib/lemonsqueezy';
import { mintAndSignToken } from '../lib/tokens';
import {
  findLicenseByMerchantOrder,
  findLicenseByMerchantSubscription,
  insertLicense,
  refreshLicenseToken,
  setLicenseStatus,
} from '../lib/db';
import { sendLicenseEmail } from '../lib/resend';
import { resolveLicenseSigningKey } from '../lib/licenseKeys';
import type { Env } from '../index';

export const webhooksRouter = new Hono<{ Bindings: Env }>();

const SUPPORT_GRACE_SECONDS = 14 * 24 * 60 * 60;
/**
 * Pro Lifetime keeps its Pro entitlement forever. This window only covers
 * releases included with the initial one-time purchase; renewal remains an
 * optional future commerce flow.
 */
export const PRO_LIFETIME_INCLUDED_UPDATES_SECONDS = 365 * 24 * 60 * 60;

webhooksRouter.post('/lemonsqueezy', async c => {
  const rawBody = await c.req.text();
  const verified = await verifyLemonSqueezyWebhook(
    c.req.raw.headers,
    rawBody,
    c.env.LS_WEBHOOK_SECRET
  );
  if (!verified.ok) {
    if (verified.reason === 'invalid-secret') {
      // Maintainer hasn't set the secret yet. 503-class signal so
      // monitoring catches a misconfigured worker rather than 4xx
      // flood-pretending.
      return errorResponse(c, 'not-implemented', {
        message: verified.message,
      });
    }
    if (verified.reason === 'missing-headers') {
      return jsonNoStore(
        c,
        { ok: false, reason: 'missing-headers', message: verified.message },
        400
      );
    }
    return jsonNoStore(
      c,
      { ok: false, reason: 'invalid-signature', message: verified.message },
      401
    );
  }

  let event: LemonSqueezyEvent;
  try {
    event = JSON.parse(rawBody) as LemonSqueezyEvent;
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'Webhook body is not valid JSON.' });
  }

  const eventName = event?.meta?.event_name;
  if (!event || typeof event !== 'object' || typeof eventName !== 'string') {
    return errorResponse(c, 'invalid-input', {
      message: 'Webhook event missing `meta.event_name`.',
    });
  }

  switch (eventName) {
    case 'order_created':
      return handleOrderCreated(c, event);
    case 'order_refunded':
      return handleOrderRefunded(c, event);
    case 'subscription_created':
      return handleSubscriptionCreated(c, event);
    case 'subscription_updated':
      return handleSubscriptionUpdated(c, event);
    case 'subscription_cancelled':
      return handleSubscriptionCancelled(c, event);
    case 'subscription_payment_success':
      // Renewal refreshes ride on `subscription_updated`, which carries
      // the advanced `renews_at`. The invoice event is acked so Lemon
      // Squeezy stops retrying it, but it never mints.
      return jsonNoStore(c, { ok: true, ignored: 'handled-via-subscription-updated' });
    default:
      return jsonNoStore(c, { ok: true, ignored: 'unknown-event', type: eventName });
  }
});

webhooksRouter.all('/lemonsqueezy', c => methodNotAllowedResponse(c, ['POST']));

// --------------------------------------------------------- Event handlers

type WebhookContext = Context<{ Bindings: Env }>;

interface EmitArgs {
  licenseRowId: string;
  productId: LinguaProductId;
  issuedTo: string;
  issuedAt: number;
  expiresAt: number | null;
  supportWindowEndsAt: number;
  merchantOrderId: string | null;
  merchantSubscriptionId: string | null;
  deviceLimit: number;
}

async function emitLicenseAndEmail(c: WebhookContext, args: EmitArgs): Promise<Response> {
  const signingKey = resolveLicenseSigningKey(c.env);
  if (!signingKey) {
    return errorResponse(c, 'not-implemented', {
      message: 'LINGUA_LICENSE_PRIVATE_KEY_JWK is not configured.',
    });
  }

  const minted = await mintAndSignToken(
    {
      licenseId: args.licenseRowId,
      productId: args.productId,
      issuedTo: args.issuedTo,
      issuedAt: args.issuedAt,
      expiresAt: args.expiresAt,
      supportWindowEndsAt: args.supportWindowEndsAt,
    },
    signingKey.privateKeyJwk
  );
  if (!minted.ok) {
    return errorResponse(c, 'not-implemented', {
      message: `Token minting failed: ${minted.reason}`,
    });
  }

  await insertLicense(c.env.DB, {
    id: args.licenseRowId,
    token: minted.token,
    productId: args.productId,
    tier: tierForProduct(args.productId),
    deviceLimit: args.deviceLimit,
    issuedTo: args.issuedTo,
    issuedAt: args.issuedAt,
    expiresAt: args.expiresAt,
    supportWindowEndsAt: args.supportWindowEndsAt,
    status: 'active',
    merchantOrderId: args.merchantOrderId,
    merchantSubscriptionId: args.merchantSubscriptionId,
  });

  // Email is best-effort: a Resend failure does NOT roll back the
  // license persistence. Lemon Squeezy is acked 200 so it doesn't retry
  // the whole webhook (which would hit the duplicate guard anyway).
  const emailResult = await sendLicenseEmail({
    to: args.issuedTo,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    licenseToken: minted.token,
    tier: tierForProduct(args.productId),
    productId: args.productId,
    supportWindowEndsAt: args.supportWindowEndsAt,
  });

  return jsonNoStore(c, {
    ok: true,
    licenseId: args.licenseRowId,
    emailDelivered: emailResult.ok,
    emailReason: emailResult.ok ? undefined : emailResult.reason,
  });
}

async function handleOrderCreated(c: WebhookContext, event: LemonSqueezyEvent): Promise<Response> {
  const orderId = event.data?.id;
  const attrs = orderAttributes(event);
  const email = attrs.user_email;

  if (!orderId || !email) {
    return errorResponse(c, 'invalid-input', {
      message: 'order_created is missing required fields.',
    });
  }
  if (!storeMatches(attrs.store_id, c.env)) {
    return jsonNoStore(c, { ok: true, ignored: 'unknown-store', storeId: attrs.store_id ?? null });
  }

  const variantId = attrs.first_order_item?.variant_id;
  const productId = resolveVariantSku(variantId, c.env);
  if (!productId) {
    return jsonNoStore(c, {
      ok: true,
      ignored: 'unknown-product',
      variantId: variantId ?? null,
    });
  }

  if (productId === 'lingua_monthly' || productId === 'lingua_team') {
    // The subscription event carries `order_id` + `renews_at`; minting
    // here would produce a license with no expiry to anchor. Ack and let
    // `subscription_created` do the mint.
    return jsonNoStore(c, { ok: true, ignored: 'awaiting-subscription-created', orderId });
  }

  const existing = await findLicenseByMerchantOrder(c.env.DB, orderId);
  if (existing) {
    return jsonNoStore(c, { ok: true, ignored: 'duplicate', licenseId: existing.id });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const supportWindowEndsAt = issuedAt + PRO_LIFETIME_INCLUDED_UPDATES_SECONDS;
  const deviceLimit = deviceLimitForProduct(productId, event.meta?.custom_data);

  return emitLicenseAndEmail(c, {
    licenseRowId: crypto.randomUUID(),
    productId,
    issuedTo: email,
    issuedAt,
    expiresAt: null,
    supportWindowEndsAt,
    merchantOrderId: orderId,
    merchantSubscriptionId: null,
    deviceLimit,
  });
}

async function handleOrderRefunded(c: WebhookContext, event: LemonSqueezyEvent): Promise<Response> {
  const orderId = event.data?.id;
  if (!orderId) {
    return errorResponse(c, 'invalid-input', { message: 'order_refunded missing data.id.' });
  }
  const license = await findLicenseByMerchantOrder(c.env.DB, orderId);
  if (!license) {
    return jsonNoStore(c, { ok: true, ignored: 'unknown-order', orderId });
  }
  await setLicenseStatus(c.env.DB, license.id, 'refunded');
  return jsonNoStore(c, { ok: true, licenseId: license.id, status: 'refunded' });
}

async function handleSubscriptionCreated(
  c: WebhookContext,
  event: LemonSqueezyEvent
): Promise<Response> {
  const subscriptionId = event.data?.id;
  const attrs = subscriptionAttributes(event);
  const email = attrs.user_email;
  const renewsAtIso = attrs.renews_at;

  if (!subscriptionId || !email || !renewsAtIso) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription_created is missing subscription id, user_email, or renews_at.',
    });
  }
  if (!storeMatches(attrs.store_id, c.env)) {
    return jsonNoStore(c, { ok: true, ignored: 'unknown-store', storeId: attrs.store_id ?? null });
  }

  const productId = resolveVariantSku(attrs.variant_id, c.env);
  if (!productId) {
    return jsonNoStore(c, {
      ok: true,
      ignored: 'unknown-product',
      variantId: attrs.variant_id ?? null,
    });
  }
  if (productId === 'lingua_lifetime') {
    return jsonNoStore(c, { ok: true, ignored: 'lifetime-handled-by-order-created' });
  }

  const expiresAt = Math.floor(Date.parse(renewsAtIso) / 1000);
  if (!Number.isFinite(expiresAt)) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription_created renews_at is not a valid ISO timestamp.',
    });
  }

  const existing = await findLicenseByMerchantSubscription(c.env.DB, subscriptionId);
  if (existing) {
    return jsonNoStore(c, { ok: true, ignored: 'duplicate', licenseId: existing.id });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const supportWindowEndsAt = expiresAt + SUPPORT_GRACE_SECONDS;
  const deviceLimit = deviceLimitForProduct(productId, event.meta?.custom_data);

  return emitLicenseAndEmail(c, {
    licenseRowId: crypto.randomUUID(),
    productId,
    issuedTo: email,
    issuedAt,
    expiresAt,
    supportWindowEndsAt,
    merchantOrderId: attrs.order_id !== undefined ? String(attrs.order_id) : null,
    merchantSubscriptionId: subscriptionId,
    deviceLimit,
  });
}

async function handleSubscriptionUpdated(
  c: WebhookContext,
  event: LemonSqueezyEvent
): Promise<Response> {
  const subscriptionId = event.data?.id;
  const attrs = subscriptionAttributes(event);

  if (!subscriptionId) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription_updated is missing required fields.',
    });
  }
  const license = await findLicenseByMerchantSubscription(c.env.DB, subscriptionId);
  if (!license) {
    // Race: subscription_updated can land before subscription_created.
    // Ack so the created event does the actual mint.
    return jsonNoStore(c, { ok: true, ignored: 'unknown-subscription', subscriptionId });
  }

  const cancelled = attrs.cancelled === true;
  if (cancelled) {
    await setLicenseStatus(c.env.DB, license.id, 'cancel_at_period_end');
  } else if (license.status === 'cancel_at_period_end') {
    await setLicenseStatus(c.env.DB, license.id, 'active');
  }

  // Renewal: when the paid period advanced past the stored expiry,
  // re-mint the token so `/licenses/status` hands back a fresh one.
  const renewsAt = attrs.renews_at ? Math.floor(Date.parse(attrs.renews_at) / 1000) : NaN;
  const advanced =
    Number.isFinite(renewsAt) && (license.expires_at === null || renewsAt > license.expires_at);
  if (!advanced) {
    return jsonNoStore(c, { ok: true, licenseId: license.id, cancelAtPeriodEnd: cancelled });
  }

  const signingKey = resolveLicenseSigningKey(c.env);
  if (!signingKey) {
    return errorResponse(c, 'not-implemented', {
      message: 'LINGUA_LICENSE_PRIVATE_KEY_JWK is not configured.',
    });
  }
  const supportWindowEndsAt = renewsAt + SUPPORT_GRACE_SECONDS;
  const minted = await mintAndSignToken(
    {
      licenseId: license.id,
      productId: license.product_id as LinguaProductId,
      issuedTo: license.issued_to,
      issuedAt: license.issued_at,
      expiresAt: renewsAt,
      supportWindowEndsAt,
    },
    signingKey.privateKeyJwk
  );
  if (!minted.ok) {
    return errorResponse(c, 'not-implemented', {
      message: `Token re-mint failed: ${minted.reason}`,
    });
  }
  await refreshLicenseToken(c.env.DB, license.id, minted.token, renewsAt, supportWindowEndsAt);
  return jsonNoStore(c, {
    ok: true,
    licenseId: license.id,
    refreshedTokenIssued: true,
    cancelAtPeriodEnd: cancelled,
    source: 'subscription_updated',
  });
}

async function handleSubscriptionCancelled(
  c: WebhookContext,
  event: LemonSqueezyEvent
): Promise<Response> {
  const subscriptionId = event.data?.id;
  if (!subscriptionId) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription_cancelled missing data.id.',
    });
  }
  const license = await findLicenseByMerchantSubscription(c.env.DB, subscriptionId);
  if (!license) {
    return jsonNoStore(c, { ok: true, ignored: 'unknown-subscription', subscriptionId });
  }
  await setLicenseStatus(c.env.DB, license.id, 'cancel_at_period_end');
  return jsonNoStore(c, { ok: true, licenseId: license.id, status: 'cancel_at_period_end' });
}

// ----------------------------------------------------------------- helpers

function tierForProduct(productId: LinguaProductId): 'pro' | 'pro_lifetime' | 'team' {
  if (productId === 'lingua_lifetime') return 'pro_lifetime';
  if (productId === 'lingua_team') return 'team';
  return 'pro';
}

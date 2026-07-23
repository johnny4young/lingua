/**
 * Polar webhook handler — implementation
 *
 * Verifies the Polar Standard Webhooks signature, dispatches the event
 * to a D1-backed handler, mints a fresh license token where applicable,
 * and emits an email via Resend.
 *
 * Idempotency contract:
 *   - `polar_order_id` UNIQUE in `licenses` table — duplicate
 *     `order.paid` for the same order returns `{ ok: true,
 *     ignored: 'duplicate' }` without re-issuing the email.
 *   - `polar_subscription_id` UNIQUE — same for subscription
 *     `order.paid` after payment succeeds.
 *   - subscription `order.paid` always wins for paid period changes:
 *     it mints or refreshes the token + bumps `expires_at`. Polar may
 *     retry; the renderer's `/licenses/status` returns the latest
 *     `licenses.token`.
 *   - Unknown event types ack 200 with `ignored: 'unknown-event'`
 *     so a misconfigured Polar surface is loud in observability
 *     without triggering Polar's retry storm.
 */

import { Hono, type Context } from 'hono';
import { errorResponse, methodNotAllowedResponse } from '../lib/errors';
import { jsonNoStore } from '../lib/json';
import {
  deviceLimitForProduct,
  resolveProductSku,
  verifyPolarWebhook,
  type PolarEvent,
  type PolarKnownEvent,
  type PolarProductId,
} from '../lib/polar';
import { mintAndSignToken } from '../lib/tokens';
import {
  findLicenseByPolarOrder,
  findLicenseByPolarSubscription,
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

webhooksRouter.post('/polar', async (c) => {
  const rawBody = await c.req.text();
  const verified = await verifyPolarWebhook(
    c.req.raw.headers,
    rawBody,
    c.env.POLAR_WEBHOOK_SECRET
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
    if (verified.reason === 'replay-window' || verified.reason === 'bad-timestamp') {
      return jsonNoStore(c, { ok: false, reason: verified.reason, message: verified.message }, 401);
    }
    if (verified.reason === 'missing-headers') {
      return jsonNoStore(c, { ok: false, reason: 'missing-headers', message: verified.message }, 400);
    }
    return jsonNoStore(c, { ok: false, reason: 'invalid-signature', message: verified.message }, 401);
  }

  let event: PolarEvent;
  try {
    event = JSON.parse(rawBody) as PolarEvent;
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'Webhook body is not valid JSON.' });
  }

  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    return errorResponse(c, 'invalid-input', { message: 'Webhook event missing `type`.' });
  }

  switch (event.type) {
    case 'order.paid':
      return handleOrderPaid(c, event as Extract<PolarKnownEvent, { type: 'order.paid' }>);
    case 'order.refunded':
      return handleOrderRefunded(
        c,
        event as Extract<PolarKnownEvent, { type: 'order.refunded' }>
      );
    case 'subscription.created':
      return handleSubscriptionCreated(
        c,
        event as Extract<PolarKnownEvent, { type: 'subscription.created' }>
      );
    case 'subscription.updated':
      return handleSubscriptionUpdated(
        c,
        event as Extract<PolarKnownEvent, { type: 'subscription.updated' }>
      );
    case 'subscription.canceled':
      return handleSubscriptionCanceled(
        c,
        event as Extract<PolarKnownEvent, { type: 'subscription.canceled' }>
      );
    default:
      return jsonNoStore(c, { ok: true, ignored: 'unknown-event', type: event.type });
  }
});

webhooksRouter.all('/polar', (c) => methodNotAllowedResponse(c, ['POST']));

// --------------------------------------------------------- Event handlers

type WebhookContext = Context<{ Bindings: Env }>;

interface EmitArgs {
  licenseRowId: string;
  productId: PolarProductId;
  issuedTo: string;
  issuedAt: number;
  expiresAt: number | null;
  supportWindowEndsAt: number;
  polarOrderId: string | null;
  polarSubscriptionId: string | null;
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
    polarOrderId: args.polarOrderId,
    polarSubscriptionId: args.polarSubscriptionId,
  });

  // Email is best-effort: a Resend failure does NOT roll back the
  // license persistence. Polar is acked 200 so it doesn't retry the
  // whole webhook (which would hit a UNIQUE constraint anyway).
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

async function handleOrderPaid(
  c: WebhookContext,
  event: Extract<PolarKnownEvent, { type: 'order.paid' }>
): Promise<Response> {
  const orderId = event.data?.id;
  const email = event.data?.customer?.email;
  const metadata = event.data?.product?.metadata;
  const productId = resolveProductSku(event.data?.product);

  if (!orderId || !email) {
    return errorResponse(c, 'invalid-input', { message: 'order.paid is missing required fields.' });
  }
  if (!productId) {
    return jsonNoStore(c, {
      ok: true,
      ignored: 'unknown-product',
      productId: event.data?.product?.id ?? null,
    });
  }
  if (productId === 'lingua_monthly' || productId === 'lingua_team') {
    return handleSubscriptionOrderPaid(c, event, productId, metadata);
  }

  const existing = await findLicenseByPolarOrder(c.env.DB, orderId);
  if (existing) {
    return jsonNoStore(c, { ok: true, ignored: 'duplicate', licenseId: existing.id });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const supportWindowEndsAt = issuedAt + PRO_LIFETIME_INCLUDED_UPDATES_SECONDS;
  const deviceLimit = deviceLimitForProduct(productId, metadata);

  return emitLicenseAndEmail(c, {
    licenseRowId: crypto.randomUUID(),
    productId,
    issuedTo: email,
    issuedAt,
    expiresAt: null,
    supportWindowEndsAt,
    polarOrderId: orderId,
    polarSubscriptionId: null,
    deviceLimit,
  });
}

async function handleSubscriptionOrderPaid(
  c: WebhookContext,
  event: Extract<PolarKnownEvent, { type: 'order.paid' }>,
  productId: PolarProductId,
  metadata: Record<string, unknown> | undefined
): Promise<Response> {
  const subscriptionId = event.data?.subscription_id ?? event.data?.subscription?.id;
  const email = event.data?.customer?.email;
  const periodEndIso = event.data?.subscription?.current_period_end;

  if (!subscriptionId || !email || !periodEndIso) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription order.paid is missing subscription id, customer email, or current_period_end.',
    });
  }

  const expiresAt = Math.floor(Date.parse(periodEndIso) / 1000);
  if (!Number.isFinite(expiresAt)) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription order.paid current_period_end is not a valid ISO timestamp.',
    });
  }

  const supportWindowEndsAt = expiresAt + SUPPORT_GRACE_SECONDS;
  const existing = await findLicenseByPolarSubscription(c.env.DB, subscriptionId);

  if (existing) {
    const signingKey = resolveLicenseSigningKey(c.env);
    if (!signingKey) {
      return errorResponse(c, 'not-implemented', {
        message: 'LINGUA_LICENSE_PRIVATE_KEY_JWK is not configured.',
      });
    }
    const minted = await mintAndSignToken(
      {
        licenseId: existing.id,
        productId: existing.product_id as PolarProductId,
        issuedTo: existing.issued_to,
        issuedAt: existing.issued_at,
        expiresAt,
        supportWindowEndsAt,
      },
      signingKey.privateKeyJwk
    );
    if (!minted.ok) {
      return errorResponse(c, 'not-implemented', {
        message: `Token re-mint failed: ${minted.reason}`,
      });
    }
    await refreshLicenseToken(c.env.DB, existing.id, minted.token, expiresAt, supportWindowEndsAt);
    return jsonNoStore(c, {
      ok: true,
      licenseId: existing.id,
      refreshedTokenIssued: true,
      source: 'order.paid',
    });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const deviceLimit = deviceLimitForProduct(productId, metadata);
  return emitLicenseAndEmail(c, {
    licenseRowId: crypto.randomUUID(),
    productId,
    issuedTo: email,
    issuedAt,
    expiresAt,
    supportWindowEndsAt,
    polarOrderId: null,
    polarSubscriptionId: subscriptionId,
    deviceLimit,
  });
}

async function handleOrderRefunded(
  c: WebhookContext,
  event: Extract<PolarKnownEvent, { type: 'order.refunded' }>
): Promise<Response> {
  const orderId = event.data?.order?.id;
  if (!orderId) {
    return errorResponse(c, 'invalid-input', { message: 'order.refunded missing order.id.' });
  }
  const license = await findLicenseByPolarOrder(c.env.DB, orderId);
  if (!license) {
    return jsonNoStore(c, { ok: true, ignored: 'unknown-order', orderId });
  }
  await setLicenseStatus(c.env.DB, license.id, 'refunded');
  return jsonNoStore(c, { ok: true, licenseId: license.id, status: 'refunded' });
}

async function handleSubscriptionCreated(
  c: WebhookContext,
  event: Extract<PolarKnownEvent, { type: 'subscription.created' }>
): Promise<Response> {
  const subscriptionId = event.data?.id;
  const productId = resolveProductSku(event.data?.product);

  if (!subscriptionId) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription.created is missing required fields.',
    });
  }
  if (!productId) {
    return jsonNoStore(c, {
      ok: true,
      ignored: 'unknown-product',
      productId: event.data?.product?.id ?? null,
    });
  }
  if (productId === 'lingua_lifetime') {
    return jsonNoStore(c, { ok: true, ignored: 'lifetime-handled-by-order-paid' });
  }

  const existing = await findLicenseByPolarSubscription(c.env.DB, subscriptionId);
  if (existing) {
    return jsonNoStore(c, { ok: true, ignored: 'duplicate', licenseId: existing.id });
  }

  return jsonNoStore(c, { ok: true, ignored: 'awaiting-order-paid', subscriptionId });
}

async function handleSubscriptionUpdated(
  c: WebhookContext,
  event: Extract<PolarKnownEvent, { type: 'subscription.updated' }>
): Promise<Response> {
  const subscriptionId = event.data?.id;
  const cancelAtPeriodEnd = event.data?.cancel_at_period_end === true;

  if (!subscriptionId) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription.updated is missing required fields.',
    });
  }
  const license = await findLicenseByPolarSubscription(c.env.DB, subscriptionId);
  if (!license) {
    // Race condition: subscription.updated sometimes lands before
    // the paid order. Ack so order.paid does the actual mint after
    // payment has succeeded.
    return jsonNoStore(c, { ok: true, ignored: 'unknown-subscription', subscriptionId });
  }

  if (cancelAtPeriodEnd) {
    await setLicenseStatus(c.env.DB, license.id, 'cancel_at_period_end');
  } else if (license.status === 'cancel_at_period_end') {
    await setLicenseStatus(c.env.DB, license.id, 'active');
  }
  return jsonNoStore(c, {
    ok: true,
    licenseId: license.id,
    cancelAtPeriodEnd,
    ignored: 'awaiting-order-paid',
  });
}

async function handleSubscriptionCanceled(
  c: WebhookContext,
  event: Extract<PolarKnownEvent, { type: 'subscription.canceled' }>
): Promise<Response> {
  const subscriptionId = event.data?.id;
  if (!subscriptionId) {
    return errorResponse(c, 'invalid-input', {
      message: 'subscription.canceled missing data.id.',
    });
  }
  const license = await findLicenseByPolarSubscription(c.env.DB, subscriptionId);
  if (!license) {
    return jsonNoStore(c, { ok: true, ignored: 'unknown-subscription', subscriptionId });
  }
  await setLicenseStatus(c.env.DB, license.id, 'cancel_at_period_end');
  return jsonNoStore(c, { ok: true, licenseId: license.id, status: 'cancel_at_period_end' });
}

// ----------------------------------------------------------------- helpers

function tierForProduct(productId: PolarProductId): 'pro' | 'pro_lifetime' | 'team' {
  if (productId === 'lingua_lifetime') return 'pro_lifetime';
  if (productId === 'lingua_team') return 'team';
  return 'pro';
}

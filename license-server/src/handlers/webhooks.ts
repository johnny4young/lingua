/**
 * POST /webhooks/polar — Slice 1 placeholder.
 *
 * Slice 2 implements:
 *   - HMAC-SHA256 signature verification against POLAR_WEBHOOK_SECRET.
 *   - Event mapping for order.paid / order.refunded / subscription.created
 *     / subscription.updated / subscription.canceled.
 *   - Token mint + Resend email on first issuance, refreshed-token mint
 *     on subscription.updated, status flip on cancellation/refund.
 *
 * Slice 1 returns 501 unconditionally so a stray test-mode webhook from
 * the maintainer's Polar sandbox during pre-release setup does not get
 * silently accepted. We do NOT validate the body or signature here —
 * that whole layer is Slice 2's responsibility and reading the body
 * without verifying the signature would expose the worker to replay
 * attacks once the secret lands.
 */

import { Hono } from 'hono';
import { methodNotAllowedResponse, notImplementedResponse } from '../lib/errors';

export const webhooksRouter = new Hono();

webhooksRouter.post('/polar', (c) =>
  notImplementedResponse(
    c,
    'Polar webhook scaffolded. Signature verification + event handlers pending Slice 2.',
  ),
);

webhooksRouter.all('/polar', (c) => methodNotAllowedResponse(c, ['POST']));

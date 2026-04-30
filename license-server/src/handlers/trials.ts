/**
 * POST /trials/start — RL-061 Slice 4 real implementation.
 *
 * Slice 1 shipped a 501 stub that validated the body shape. This
 * commit replaces the stub with the actual trial flow per
 * LICENSING_ADR Decision 5: 14 days, 1 device, full Pro
 * entitlements, anti-abuse via UNIQUE(email) + UNIQUE(device_id)
 * + per-IP KV rate limit (3/day).
 *
 * Body (validated by `lib/validation.ts:validateTrialStartBody`):
 *   { email, deviceId, deviceName, os }
 *
 * Response shape (success):
 *   { ok: true, licenseId, token, tier: 'trial', expiresAt,
 *     emailDelivered: boolean, emailReason?: string }
 *
 * Response shape (failure tagged-union):
 *   { ok: false, reason: 'trial-exists-email', canRecover: true }
 *   { ok: false, reason: 'trial-exists-device' }
 *   { ok: false, reason: 'rate-limited', retryAfter: number }
 *   { ok: false, reason: 'invalid-input', issues: string[] }
 *   { ok: false, reason: 'not-implemented', message: string }
 *
 * The token is returned in the body even on success so the
 * renderer can auto-paste the freshly-minted trial without
 * waiting for the Resend email to land. Email delivery is
 * best-effort — a Resend outage does NOT roll back the trial
 * persistence (the user can recover the token via /licenses/recover
 * any time).
 */

import { Hono } from 'hono';
import {
  errorResponse,
  methodNotAllowedResponse,
  notImplementedResponse,
} from '../lib/errors';
import { jsonNoStore } from '../lib/json';
import { validateTrialStartBody } from '../lib/validation';
import { mintAndSignToken } from '../lib/tokens';
import {
  findTrialByDeviceId,
  findTrialByEmail,
  insertLicense,
  insertTrial,
} from '../lib/db';
import { sendTrialEmail } from '../lib/resend';
import { consumeRateLimit } from '../lib/rateLimit';
import type { Env } from '../index';

const TRIAL_PRODUCT_ID = 'lingua_trial' as const;
const TRIAL_DURATION_SECONDS = 14 * 24 * 60 * 60; // 14 days
const TRIAL_RATE_LIMIT_PER_DAY = 3;

function parseJwk(raw: string): JsonWebKey | null {
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    return null;
  }
}

/**
 * Read the client IP for rate-limiting. CF puts the real IP in
 * `CF-Connecting-IP`; fall back to `X-Forwarded-For` for tests.
 */
function clientIp(headers: { header: (name: string) => string | undefined }): string {
  return (
    headers.header('cf-connecting-ip') ||
    headers.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export const trialsRouter = new Hono<{ Bindings: Env }>();

trialsRouter.post('/start', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }

  const validation = validateTrialStartBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { email, deviceId, deviceName, os } = validation.value;
  void deviceName;
  void os;

  const privateKeyJwk = parseJwk(c.env.LINGUA_LICENSE_PRIVATE_KEY_JWK);
  if (!privateKeyJwk) {
    return notImplementedResponse(
      c,
      'LINGUA_LICENSE_PRIVATE_KEY_JWK is not configured. Trial endpoint is in dev-disabled mode.'
    );
  }

  // Rate-limit BEFORE the DB so KV catches abuse before it touches
  // schema-level UNIQUEs.
  const ip = clientIp(c.req);
  const rl = await consumeRateLimit(c.env.RATE_LIMIT, {
    scope: 'trials',
    keyPart: ip,
    limit: TRIAL_RATE_LIMIT_PER_DAY,
  });
  if (!rl.allowed) {
    return jsonNoStore(
      c,
      { ok: false, reason: 'rate-limited', retryAfter: rl.retryAfter },
      429
    );
  }

  // Anti-abuse pre-check. Schema-level UNIQUE on email + device_id
  // is the authoritative gate; pre-check gives a clean
  // tagged-union failure instead of a 500 from the INSERT collision.
  const existingByEmail = await findTrialByEmail(c.env.DB, email);
  if (existingByEmail) {
    return jsonNoStore(c, {
      ok: false,
      reason: 'trial-exists-email',
      canRecover: true,
    });
  }
  const existingByDevice = await findTrialByDeviceId(c.env.DB, deviceId);
  if (existingByDevice) {
    return jsonNoStore(c, { ok: false, reason: 'trial-exists-device' });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TRIAL_DURATION_SECONDS;
  const licenseId = crypto.randomUUID();
  const trialId = crypto.randomUUID();

  const minted = await mintAndSignToken(
    {
      licenseId,
      productId: TRIAL_PRODUCT_ID,
      issuedTo: email,
      issuedAt,
      expiresAt,
      supportWindowEndsAt: expiresAt,
    },
    privateKeyJwk
  );
  if (!minted.ok) {
    return errorResponse(c, 'not-implemented', {
      message: `Token minting failed: ${minted.reason}`,
    });
  }

  await insertLicense(c.env.DB, {
    id: licenseId,
    token: minted.token,
    productId: TRIAL_PRODUCT_ID,
    tier: 'trial',
    deviceLimit: 1,
    issuedTo: email,
    issuedAt,
    expiresAt,
    supportWindowEndsAt: expiresAt,
    status: 'active',
    polarOrderId: null,
    polarSubscriptionId: null,
  });
  await insertTrial(c.env.DB, { id: trialId, email, deviceId, licenseId, issuedAt });

  const emailResult = await sendTrialEmail({
    to: email,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    token: minted.token,
    issuedTo: email,
    expiresAt,
    deepLink: `lingua://license?token=${encodeURIComponent(minted.token)}`,
  });

  return jsonNoStore(c, {
    ok: true,
    licenseId,
    token: minted.token,
    tier: 'trial',
    expiresAt,
    emailDelivered: emailResult.ok,
    emailReason: emailResult.ok ? undefined : emailResult.reason,
  });
});

trialsRouter.all('/start', (c) => methodNotAllowedResponse(c, ['POST']));

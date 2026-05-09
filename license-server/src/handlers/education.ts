/**
 * RL-061 Slice 4 — Education endpoints (magic-link two-step + renew).
 *
 *   POST /education/start                  validates .edu, persists
 *                                          pending row, sends confirm email.
 *   GET  /education/confirm?confirm=<id>   validates pending row,
 *                                          mints license, sends token email,
 *                                          returns success HTML.
 *   POST /education/renew                  re-runs .edu check, re-mints
 *                                          for another year, sends refresh
 *                                          email.
 *
 * Magic-link details (Decision 5 of LICENSING_ADR):
 * - 24h TTL on the pending row.
 * - Single-use: once `confirmed_at != NULL`, subsequent /confirm hits
 *   re-render the success HTML idempotently (do NOT mint a second
 *   license).
 * - Anti-abuse layered: per-IP KV rate limit + UNIQUE(email) +
 *   UNIQUE(device_id) on the `educations` table.
 *
 * Renew re-mints (Decision 5 + new "Token re-mint on renewal is
 * transparent" decision in this slice's docs sync). The renderer
 * picks up `refreshedToken` via /licenses/status auto-refresh, so
 * the user never re-pastes.
 */

import { Hono } from 'hono';
import {
  errorResponse,
  methodNotAllowedResponse,
  notImplementedResponse,
} from '../lib/errors';
import { jsonNoStore } from '../lib/json';
import {
  validateConfirmQuery,
  validateEducationRenewBody,
  validateEducationStartBody,
} from '../lib/validation';
import { mintAndSignToken } from '../lib/tokens';
import { verifyLicenseToken } from '../lib/sign';
import { isEducationalEmail } from '../lib/educationEmail';
import {
  findEducationByDeviceId,
  findEducationByEmail,
  findEducationPendingById,
  findLicenseById,
  insertEducation,
  insertEducationPending,
  insertLicense,
  markEducationPendingConfirmed,
  refreshLicenseToken,
} from '../lib/db';
import {
  sendEducationConfirmationEmail,
  sendEducationRenewalEmail,
  sendEducationTokenEmail,
} from '../lib/resend';
import { consumeRateLimit } from '../lib/rateLimit';
import type { Env } from '../index';

const EDUCATION_PRODUCT_ID = 'lingua_education' as const;
const EDUCATION_DURATION_SECONDS = 365 * 24 * 60 * 60; // 1 year
const EDUCATION_PENDING_TTL_SECONDS = 24 * 60 * 60; // 24h
const EDUCATION_RATE_LIMIT_PER_DAY = 3;

function parseJwk(raw: string): JsonWebKey | null {
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    return null;
  }
}

function clientIp(headers: { header: (name: string) => string | undefined }): string {
  return (
    headers.header('cf-connecting-ip') ||
    headers.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Build the magic-link URL the user clicks from email. The host
 * comes from the request itself so dev (localhost:8787) and prod
 * (licenses.linguacode.dev) both work without a config change.
 */
function buildConfirmLink(
  base: string,
  surface: 'education' | 'recovery',
  pendingId: string
): string {
  return `${base.replace(/\/$/u, '')}/${surface}/confirm?confirm=${encodeURIComponent(pendingId)}`;
}

function htmlSuccessPage(title: string, message: string): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#0c1017;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
.card{background:#161b22;border:1px solid rgba(148,163,184,0.18);border-radius:16px;padding:32px;max-width:480px;text-align:center;}
h1{font-size:22px;margin:0 0 12px;color:#fff;}
p{color:#cbd5e1;line-height:1.5;}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function htmlErrorPage(title: string, message: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#0c1017;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
.card{background:#161b22;border:1px solid rgba(248,113,113,0.4);border-radius:16px;padding:32px;max-width:480px;text-align:center;}
h1{font-size:22px;margin:0 0 12px;color:#fff;}
p{color:#cbd5e1;line-height:1.5;}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    }
  );
}

export const educationRouter = new Hono<{ Bindings: Env }>();

// ----------------------------------------------- POST /education/start

educationRouter.post('/start', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }
  const validation = validateEducationStartBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { email, deviceId, deviceName, os } = validation.value;

  if (!isEducationalEmail(email).ok) {
    return jsonNoStore(c, { ok: false, reason: 'not-educational' }, 400);
  }

  const ip = clientIp(c.req);
  const rl = await consumeRateLimit(c.env.RATE_LIMIT, {
    scope: 'education',
    keyPart: ip,
    limit: EDUCATION_RATE_LIMIT_PER_DAY,
  });
  if (!rl.allowed) {
    return jsonNoStore(
      c,
      { ok: false, reason: 'rate-limited', retryAfter: rl.retryAfter },
      429
    );
  }

  const existingByEmail = await findEducationByEmail(c.env.DB, email);
  if (existingByEmail) {
    return jsonNoStore(c, {
      ok: false,
      reason: 'education-unavailable',
      canRecover: true,
    });
  }
  const existingByDevice = await findEducationByDeviceId(c.env.DB, deviceId);
  if (existingByDevice) {
    return jsonNoStore(c, {
      ok: false,
      reason: 'education-unavailable',
      canRecover: true,
    });
  }

  const pendingId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await insertEducationPending(c.env.DB, {
    id: pendingId,
    email,
    deviceId,
    deviceName,
    os,
    createdAt: now,
    expiresAt: now + EDUCATION_PENDING_TTL_SECONDS,
  });

  const confirmLink = buildConfirmLink(new URL(c.req.url).origin, 'education', pendingId);
  const emailResult = await sendEducationConfirmationEmail({
    to: email,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    issuedTo: email,
    confirmLink,
  });
  if (!emailResult.ok) {
    return jsonNoStore(c, {
      ok: false,
      reason: 'confirmation-email-failed',
      emailReason: emailResult.reason,
    });
  }

  return jsonNoStore(c, {
    ok: true,
    pending: true,
    message: 'Confirmation email sent. Check your inbox.',
    expiresAt: now + EDUCATION_PENDING_TTL_SECONDS,
    emailDelivered: true,
  });
});

educationRouter.all('/start', (c) => methodNotAllowedResponse(c, ['POST']));

// ---------------------------------------------- GET /education/confirm

educationRouter.get('/confirm', async (c) => {
  const params = new URL(c.req.url).searchParams;
  const validation = validateConfirmQuery(params);
  if (!validation.ok) {
    return htmlErrorPage(
      'Confirmation link is invalid',
      'The confirmation parameter is missing or malformed. Start the Education flow again from Settings → License.',
      400
    );
  }
  const { confirm } = validation.value;

  const pending = await findEducationPendingById(c.env.DB, confirm);
  const now = Math.floor(Date.now() / 1000);
  if (!pending) {
    return htmlErrorPage(
      'Confirmation link not found',
      'This link is unknown to the server. Start the Education flow again from Settings → License.',
      404
    );
  }
  if (pending.expires_at < now && pending.confirmed_at === null) {
    return htmlErrorPage(
      'Confirmation link expired',
      'This link is older than 24 hours. Start the Education flow again from Settings → License.',
      410
    );
  }
  // Idempotent — already confirmed → just re-render the success page.
  if (pending.confirmed_at !== null) {
    return htmlSuccessPage(
      'Education plan confirmed',
      'Your Lingua Education plan is already active. Check your inbox for the license token email.'
    );
  }

  const existingByEmail = await findEducationByEmail(c.env.DB, pending.email);
  if (existingByEmail) {
    await markEducationPendingConfirmed(c.env.DB, pending.id, now);
    return htmlSuccessPage(
      'Education plan confirmed',
      'Your Lingua Education plan is already active. Check your inbox for the license token email.'
    );
  }
  const existingByDevice = await findEducationByDeviceId(c.env.DB, pending.device_id);
  if (existingByDevice) {
    await markEducationPendingConfirmed(c.env.DB, pending.id, now);
    return htmlErrorPage(
      'Education plan already exists on this device',
      'This device already has a Lingua Education plan. Open Lingua on that device or contact support if this looks wrong.',
      409
    );
  }

  // Mint + persist + send token email. Claim the pending row before
  // inserting so duplicate clicks or multiple pending links cannot mint
  // more than one education license.
  const privateKeyJwk = parseJwk(c.env.LINGUA_LICENSE_PRIVATE_KEY_JWK);
  if (!privateKeyJwk) {
    return htmlErrorPage(
      'Server is not configured',
      'The license server is not configured to mint education tokens. Contact support.',
      503
    );
  }

  const issuedAt = now;
  const expiresAt = issuedAt + EDUCATION_DURATION_SECONDS;
  const licenseId = crypto.randomUUID();
  const educationId = crypto.randomUUID();

  const minted = await mintAndSignToken(
    {
      licenseId,
      productId: EDUCATION_PRODUCT_ID,
      issuedTo: pending.email,
      issuedAt,
      expiresAt,
      supportWindowEndsAt: expiresAt,
    },
    privateKeyJwk
  );
  if (!minted.ok) {
    return htmlErrorPage(
      'Could not mint your license',
      `Token minting failed: ${minted.reason}. Try again from Settings → License.`,
      500
    );
  }

  const claim = await markEducationPendingConfirmed(c.env.DB, pending.id, now);
  if (claim.affected === 0) {
    return htmlSuccessPage(
      'Education plan confirmed',
      'Your Lingua Education plan is already active. Check your inbox for the license token email.'
    );
  }

  await insertLicense(c.env.DB, {
    id: licenseId,
    token: minted.token,
    productId: EDUCATION_PRODUCT_ID,
    tier: 'education',
    deviceLimit: 3,
    issuedTo: pending.email,
    issuedAt,
    expiresAt,
    supportWindowEndsAt: expiresAt,
    status: 'active',
    polarOrderId: null,
    polarSubscriptionId: null,
  });
  await insertEducation(c.env.DB, {
    id: educationId,
    email: pending.email,
    deviceId: pending.device_id,
    licenseId,
    issuedAt,
  });

  const tokenEmailResult = await sendEducationTokenEmail({
    to: pending.email,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    token: minted.token,
    issuedTo: pending.email,
    expiresAt,
    deepLink: `lingua://license?token=${encodeURIComponent(minted.token)}`,
  });
  if (!tokenEmailResult.ok) {
    return htmlSuccessPage(
      'Education plan confirmed',
      `Your Lingua Education plan is active, but we could not send the token email. Copy this token into Settings → License: ${minted.token}`
    );
  }

  return htmlSuccessPage(
    'Education plan confirmed',
    'We just emailed you the license token. Open Lingua, paste it under Settings → License, and Pro features unlock for the next year.'
  );
});

educationRouter.all('/confirm', (c) => methodNotAllowedResponse(c, ['GET']));

// ---------------------------------------------- POST /education/renew

educationRouter.post('/renew', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }
  const validation = validateEducationRenewBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { token, email } = validation.value;

  const publicKeyJwk = parseJwk(c.env.LINGUA_LICENSE_PUBLIC_KEY_JWK);
  if (!publicKeyJwk) {
    return notImplementedResponse(
      c,
      'LINGUA_LICENSE_PUBLIC_KEY_JWK is not configured.'
    );
  }
  const verified = await verifyLicenseToken(token, publicKeyJwk);
  if (!verified.ok) {
    return jsonNoStore(c, { ok: false, reason: verified.reason }, 401);
  }
  if (verified.payload.tier !== 'education') {
    return jsonNoStore(c, { ok: false, reason: 'unsupported-tier' }, 401);
  }

  // Re-validate the educational email at renewal time. If the user
  // graduated and the email no longer matches an educational
  // domain (rare in practice — most schools keep alumni .edu), the
  // renewal is rejected and the plan lapses gracefully.
  if (!isEducationalEmail(email).ok) {
    return jsonNoStore(c, { ok: false, reason: 'not-educational' }, 400);
  }
  if (verified.payload.issuedTo.toLowerCase() !== email.toLowerCase()) {
    return jsonNoStore(c, { ok: false, reason: 'email-mismatch' }, 400);
  }

  const educationRow = await findEducationByEmail(c.env.DB, email);
  if (!educationRow) {
    return jsonNoStore(c, { ok: false, reason: 'unknown-license' }, 404);
  }

  const licenseRow = await findLicenseById(c.env.DB, educationRow.license_id);
  if (!licenseRow) {
    return jsonNoStore(c, { ok: false, reason: 'unknown-license' }, 404);
  }

  const privateKeyJwk = parseJwk(c.env.LINGUA_LICENSE_PRIVATE_KEY_JWK);
  if (!privateKeyJwk) {
    return notImplementedResponse(
      c,
      'LINGUA_LICENSE_PRIVATE_KEY_JWK is not configured.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const newExpiresAt = now + EDUCATION_DURATION_SECONDS;
  const minted = await mintAndSignToken(
    {
      licenseId: licenseRow.id,
      productId: EDUCATION_PRODUCT_ID,
      issuedTo: email,
      issuedAt: now,
      expiresAt: newExpiresAt,
      supportWindowEndsAt: newExpiresAt,
    },
    privateKeyJwk
  );
  if (!minted.ok) {
    return errorResponse(c, 'not-implemented', {
      message: `Token minting failed: ${minted.reason}`,
    });
  }

  await refreshLicenseToken(
    c.env.DB,
    licenseRow.id,
    minted.token,
    newExpiresAt,
    newExpiresAt
  );

  const renewalEmailResult = await sendEducationRenewalEmail({
    to: email,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    token: minted.token,
    issuedTo: email,
    expiresAt: newExpiresAt,
  });

  return jsonNoStore(c, {
    ok: true,
    licenseId: licenseRow.id,
    refreshedToken: minted.token,
    tier: 'education',
    expiresAt: newExpiresAt,
    emailDelivered: renewalEmailResult.ok,
    emailReason: renewalEmailResult.ok ? undefined : renewalEmailResult.reason,
  });
});

educationRouter.all('/renew', (c) => methodNotAllowedResponse(c, ['POST']));

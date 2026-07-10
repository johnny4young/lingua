/**
 * RL-061 Slice 4 — Recovery endpoints (magic-link two-step).
 *
 *   POST /licenses/recover/start                 validates email,
 *                                                 persists pending row,
 *                                                 sends confirm email.
 *                                                 ALWAYS 200.
 *   GET  /licenses/recover/confirm?confirm=<id>  validates pending row,
 *                                                 looks up license by
 *                                                 email, sends token email,
 *                                                 returns success HTML.
 *
 * No-info-leak design (LICENSING_ADR Decision 7):
 * - /start ALWAYS returns 200 with the same neutral copy whether
 *   the email matches a known license or not. Prevents enumeration.
 * - Pending row is created EVEN for unknown emails so the timing
 *   matches. The /confirm step then no-ops on the unknown branch.
 * - Rate-limit (per-IP and per-email) prevents abuse without
 *   leaking which emails exist.
 *
 * Magic-link details:
 * - 24h TTL on the pending row.
 * - Single-use: subsequent /confirm hits with confirmed_at != NULL
 *   re-render the success HTML idempotently.
 *
 * Failure modes are intentionally vague to the client. The /confirm
 * step uses the same success HTML for "we sent the token" and "no
 * matching license" so an attacker enumerating confirm IDs cannot
 * distinguish the two. The only differentiable response is "link
 * expired" which is unavoidable (a confirmed magic-link must
 * recognize itself as expired).
 */

import { Hono } from 'hono';
import {
  errorResponse,
  methodNotAllowedResponse,
} from '../lib/errors';
import { jsonNoStore } from '../lib/json';
import {
  validateConfirmQuery,
  validateLicenseRecoverBody,
} from '../lib/validation';
import {
  findLicenseByEmail,
  findRecoveryPendingById,
  insertRecoveryPending,
  markRecoveryPendingConfirmed,
} from '../lib/db';
import {
  sendRecoveryConfirmationEmail,
  sendRecoveryTokenEmail,
  type SendLicenseEmailInput,
} from '../lib/resend';
import { consumeRateLimit } from '../lib/rateLimit';
import type { Env } from '../index';

const RECOVERY_PENDING_TTL_SECONDS = 24 * 60 * 60; // 24h
const RECOVERY_RATE_LIMIT_PER_IP_PER_DAY = 5;
const RECOVERY_RATE_LIMIT_PER_EMAIL_PER_DAY = 3;

function clientIp(headers: { header: (name: string) => string | undefined }): string {
  return (
    headers.header('cf-connecting-ip') ||
    headers.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function buildConfirmLink(base: string, pendingId: string): string {
  return `${base.replace(/\/$/u, '')}/licenses/recover/confirm?confirm=${encodeURIComponent(pendingId)}`;
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

const NEUTRAL_RECOVERY_BODY = {
  ok: true as const,
  pending: true as const,
  message:
    'If that email matches a Lingua license, the recovery email is on its way. Check your inbox.',
};

/**
 * Cloudflare Workers reject `new Response(...)` calls at module
 * top-level (Disallowed operation called within global scope). The
 * success HTML is the same for every successful confirm so it would
 * be ideal to construct once, but the runtime forces us to build a
 * fresh Response per request. The body is small (< 1 KiB) and the
 * handler is hit at most once per recovery flow per user, so the
 * per-request allocation is a non-issue.
 */
function recoverySuccessHtml(): Response {
  return htmlSuccessPage(
    'License recovery received',
    'We just emailed you the latest license token if a matching license was found. Check your inbox.'
  );
}

export const recoverRouter = new Hono<{ Bindings: Env }>();

// ------------------------------------- POST /licenses/recover/start

recoverRouter.post('/start', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return errorResponse(c, 'invalid-input', { message: 'body must be valid JSON' });
  }
  const validation = validateLicenseRecoverBody(raw);
  if (!validation.ok) {
    return errorResponse(c, 'invalid-input', { issues: validation.issues });
  }
  const { email } = validation.value;

  // Two rate-limits: per-IP catches a single attacker; per-email
  // catches a distributed attack flooding the same address. Both
  // return the same neutral 200 so the response shape never tells
  // the attacker which limit fired.
  const ip = clientIp(c.req);
  const ipRl = await consumeRateLimit(c.env.RATE_LIMIT, {
    scope: 'recovery-ip',
    keyPart: ip,
    limit: RECOVERY_RATE_LIMIT_PER_IP_PER_DAY,
  });
  const emailRl = await consumeRateLimit(c.env.RATE_LIMIT, {
    scope: 'recovery-email',
    keyPart: email,
    limit: RECOVERY_RATE_LIMIT_PER_EMAIL_PER_DAY,
  });
  if (!ipRl.allowed || !emailRl.allowed) {
    // Same neutral 200 as the happy path. Logged server-side via
    // CF observability for ops visibility.
    return jsonNoStore(c, NEUTRAL_RECOVERY_BODY);
  }

  // Always create a pending row + send a confirmation email (even
  // for unknown emails) so timing matches across the known /
  // unknown split. The /confirm step is the actual gate.
  const pendingId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await insertRecoveryPending(c.env.DB, {
    id: pendingId,
    email,
    createdAt: now,
    expiresAt: now + RECOVERY_PENDING_TTL_SECONDS,
  });

  const confirmLink = buildConfirmLink(new URL(c.req.url).origin, pendingId);
  await sendRecoveryConfirmationEmail({
    to: email,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    confirmLink,
  });

  return jsonNoStore(c, NEUTRAL_RECOVERY_BODY);
});

recoverRouter.all('/start', (c) => methodNotAllowedResponse(c, ['POST']));

// ----------------------------------- GET /licenses/recover/confirm

recoverRouter.get('/confirm', async (c) => {
  const params = new URL(c.req.url).searchParams;
  const validation = validateConfirmQuery(params);
  if (!validation.ok) {
    return htmlErrorPage(
      'Recovery link is invalid',
      'The confirmation parameter is missing or malformed. Start the recovery flow again from Settings → License.',
      400
    );
  }
  const { confirm } = validation.value;

  const pending = await findRecoveryPendingById(c.env.DB, confirm);
  const now = Math.floor(Date.now() / 1000);
  if (!pending) {
    // Same generic page as the success branch — do NOT differentiate
    // unknown vs found.
    return recoverySuccessHtml();
  }
  if (pending.expires_at < now && pending.confirmed_at === null) {
    return htmlErrorPage(
      'Recovery link expired',
      'This link is older than 24 hours. Start the recovery flow again from Settings → License.',
      410
    );
  }
  if (pending.confirmed_at !== null) {
    // Idempotent re-render.
    return recoverySuccessHtml();
  }

  // Look up the license by email. If found, send the token.
  // Either way, mark the pending row confirmed so the link cannot
  // be replayed.
  await markRecoveryPendingConfirmed(c.env.DB, pending.id, now);
  const license = await findLicenseByEmail(c.env.DB, pending.email);
  if (!license) {
    // No matching license — no email sent. Same success page so
    // the user cannot distinguish "no license for this email" from
    // "license found and emailed".
    return recoverySuccessHtml();
  }

  // Server is not configured — render generic success but log
  // server-side. Do NOT leak the configuration state to the user
  // (otherwise the status code 501 would let an attacker distinguish
  // "license exists" from "no license" on a misconfigured server).
  if (!c.env.RESEND_API_KEY) {
    console.error(
      '[recover/confirm] RESEND_API_KEY missing — license found but token email skipped',
    );
    return recoverySuccessHtml();
  }

  await sendRecoveryTokenEmail({
    to: pending.email,
    fromEmail: c.env.RESEND_FROM_EMAIL,
    fromName: c.env.RESEND_FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    token: license.token,
    issuedTo: license.issued_to,
    tier: license.tier as SendLicenseEmailInput['tier'],
    expiresAt: license.expires_at,
    supportWindowEndsAt: license.support_window_ends_at,
    deepLink: `lingua://license?token=${encodeURIComponent(license.token)}`,
  });

  return recoverySuccessHtml();
});

recoverRouter.all('/confirm', (c) => methodNotAllowedResponse(c, ['GET']));

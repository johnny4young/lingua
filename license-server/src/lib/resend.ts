/**
 * Resend HTTP client — handles every transactional email Lingua's
 * license-server sends.
 *
 * Slice 2 introduced `sendLicenseEmail` for the paid Polar
 * `order.paid` flow. Slice 4 adds five more wrappers for the
 * trial / education / recovery surfaces, each backed by an HTML
 * template under `src/emails/*.html` rendered through
 * `lib/renderTemplate.ts`. All six wrappers share the same
 * `postToResend` core so the failure semantics, headers, and
 * "no API key → no-op" handshake are consistent.
 *
 * Failure modes (any wrapper):
 *   - `RESEND_API_KEY` unset → `{ ok: false, reason: 'no-api-key' }`.
 *     Callers treat this as best-effort and continue (the row in D1
 *     is the source of truth; users can recover the token via
 *     `/licenses/recover` if the email was lost).
 *   - 4xx/5xx → `{ ok: false, reason: 'api-error', status, message }`.
 *   - Network error → `{ ok: false, reason: 'network-error' }`.
 */

// HTML / CSS templates are loaded as plain text via the `[[rules]]`
// block in `wrangler.toml` (esbuild Text loader for `**/*.html` and
// `**/*.css`). The matching `vitest.config.ts` plugin reads these
// extensions through `fs.readFileSync` so vitest sees the same string
// content. Both sides agree on the file path with NO `?raw` suffix —
// the suffix is a Vite-only convention that esbuild does not parse.
import layoutCss from '../emails/_layout.css';
import trialTemplate from '../emails/trial.html';
import educationConfirmationTemplate from '../emails/educationConfirmation.html';
import educationTokenTemplate from '../emails/educationToken.html';
import educationRenewalTemplate from '../emails/educationRenewal.html';
import recoveryConfirmationTemplate from '../emails/recoveryConfirmation.html';
import recoveryTokenTemplate from '../emails/recoveryToken.html';
import { renderTemplate } from './renderTemplate';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type ResendFailure =
  | { ok: false; reason: 'no-api-key' }
  | { ok: false; reason: 'api-error'; status: number; message?: string }
  | { ok: false; reason: 'network-error'; message: string };

export type ResendResult = { ok: true; id: string } | ResendFailure;

interface PostToResendInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  subject: string;
  html: string;
  text: string;
  fetchImpl?: typeof fetch;
}

/**
 * Common Resend POST. Every wrapper funnels through here so the
 * failure shape stays consistent.
 */
async function postToResend(input: PostToResendInput): Promise<ResendResult> {
  if (!input.apiKey || input.apiKey.length === 0) {
    return { ok: false, reason: 'no-api-key' };
  }
  const body = {
    from: `${input.fromName} <${input.fromEmail}>`,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'network-error',
      message: error instanceof Error ? error.message : 'fetch threw',
    };
  }
  if (!response.ok) {
    let message: string | undefined;
    try {
      const errorBody = await response.json();
      if (errorBody && typeof errorBody === 'object' && 'message' in errorBody) {
        message = String((errorBody as { message: unknown }).message);
      }
    } catch {
      // ignore parse failure
    }
    return { ok: false, reason: 'api-error', status: response.status, message };
  }
  let id: string | undefined;
  try {
    const parsed = (await response.json()) as { id?: string };
    id = parsed.id;
  } catch {
    // No id in response.
  }
  return { ok: true, id: id ?? 'unknown' };
}

// -------------------------------------------------------- helpers

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailFromTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return renderTemplate(template, { layoutCss, ...vars });
}

/**
 * Format a unix-seconds timestamp as a human-readable date string
 * for the `{{expiresOn}}` placeholder. Uses `en-US` long format
 * for predictability across locales — emails ship in English.
 */
function formatExpiresOn(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ---------------------------------------- Slice 2: paid licenses

export type PaidTier = 'pro' | 'pro_lifetime' | 'team';

export interface SendLicenseEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  licenseToken: string;
  tier: PaidTier | 'trial' | 'education';
  productId: string;
  /**
   * The end of the subscription term for renewable tiers, or the included
   * update/support window for Pro Lifetime. It never limits Pro Lifetime
   * feature access.
   */
  supportWindowEndsAt: number | null;
  fetchImpl?: typeof fetch;
}

const TIER_HUMAN: Record<SendLicenseEmailInput['tier'], string> = {
  pro: 'Lingua Monthly',
  pro_lifetime: 'Lingua Pro',
  team: 'Lingua Pro',
  trial: 'Lingua Trial',
  education: 'Lingua Education',
};

function lifetimeUpdateTerms(supportWindowEndsAt: number | null): string {
  if (supportWindowEndsAt === null) {
    return 'Your Pro features stay unlocked forever. Renewal is optional if you want later updates.';
  }

  return [
    'Your Pro features stay unlocked forever.',
    `Included updates and priority email support run through ${formatExpiresOn(supportWindowEndsAt)}.`,
    'Renewal is optional if you want later updates.',
  ].join(' ');
}

function buildPaidHtmlBody(
  token: string,
  productLabel: string,
  tier: SendLicenseEmailInput['tier'],
  supportWindowEndsAt: number | null,
): string {
  const safeToken = escapeHtml(token);
  const safeLabel = escapeHtml(productLabel);
  const lifetimeTerms =
    tier === 'pro_lifetime'
      ? `<p style="margin:16px 0 0 0;font-size:13px;color:#6b6b76;">${escapeHtml(lifetimeUpdateTerms(supportWindowEndsAt))}</p>`
      : '';
  return [
    '<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#0a0a0f;background:#f7f7f9;padding:24px;">',
    `<h1 style="font-size:18px;margin:0 0 16px 0;">Welcome to ${safeLabel}.</h1>`,
    '<p style="margin:0 0 16px 0;">Your Lingua license is ready. Paste the token below into the app under <strong>Settings → License → Paste a license token</strong>.</p>',
    `<pre style="background:#0a0a0f;color:#e7e7ec;padding:16px;border-radius:8px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all;">${safeToken}</pre>`,
    lifetimeTerms,
    '<p style="margin:16px 0 0 0;font-size:13px;color:#6b6b76;">Tokens are tied to your email and a max of 3 desktops + 3 browsers per license. Manage devices any time from <strong>Settings → License</strong>.</p>',
    '<p style="margin:16px 0 0 0;font-size:13px;color:#6b6b76;">Lost this email? Re-request the token from <strong>Settings → License → Lost your license?</strong> any time.</p>',
    '</body></html>',
  ].join('');
}

function buildPaidTextBody(
  token: string,
  productLabel: string,
  tier: SendLicenseEmailInput['tier'],
  supportWindowEndsAt: number | null,
): string {
  const lifetimeTerms = tier === 'pro_lifetime' ? lifetimeUpdateTerms(supportWindowEndsAt) : null;
  return [
    `Welcome to ${productLabel}.`,
    '',
    'Your Lingua license is ready. Paste the token below into the app under',
    'Settings → License → Paste a license token.',
    '',
    token,
    ...(lifetimeTerms ? ['', lifetimeTerms] : []),
    '',
    'Tokens are tied to your email and a max of 3 desktops + 3 browsers per',
    'license. Manage devices any time from Settings → License.',
    '',
    'Lost this email? Re-request the token from Settings → License → Lost',
    'your license? any time.',
  ].join('\n');
}

export async function sendLicenseEmail(input: SendLicenseEmailInput): Promise<ResendResult> {
  const productLabel = TIER_HUMAN[input.tier];
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: `Your ${productLabel} license`,
    html: buildPaidHtmlBody(
      input.licenseToken,
      productLabel,
      input.tier,
      input.supportWindowEndsAt,
    ),
    text: buildPaidTextBody(
      input.licenseToken,
      productLabel,
      input.tier,
      input.supportWindowEndsAt,
    ),
    fetchImpl: input.fetchImpl,
  });
}

// ---------------------------------------- Slice 4: trial / education / recovery

export interface SendTrialEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  token: string;
  issuedTo: string;
  expiresAt: number;
  deepLink: string;
  fetchImpl?: typeof fetch;
}

export async function sendTrialEmail(input: SendTrialEmailInput): Promise<ResendResult> {
  const html = renderEmailFromTemplate(trialTemplate, {
    issuedTo: escapeHtml(input.issuedTo),
    token: escapeHtml(input.token),
    expiresOn: formatExpiresOn(input.expiresAt),
    deepLink: input.deepLink,
  });
  const text = [
    `Hi ${input.issuedTo},`,
    '',
    'Your free 14-day Lingua Pro trial is ready. Paste the token below into',
    'Settings → License inside the app:',
    '',
    input.token,
    '',
    `Trial expires on ${formatExpiresOn(input.expiresAt)}.`,
  ].join('\n');
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: 'Your Lingua Pro trial is ready',
    html,
    text,
    fetchImpl: input.fetchImpl,
  });
}

export interface SendEducationConfirmationEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  issuedTo: string;
  confirmLink: string;
  fetchImpl?: typeof fetch;
}

export async function sendEducationConfirmationEmail(
  input: SendEducationConfirmationEmailInput
): Promise<ResendResult> {
  const html = renderEmailFromTemplate(educationConfirmationTemplate, {
    issuedTo: escapeHtml(input.issuedTo),
    confirmLink: input.confirmLink,
  });
  const text = [
    `Hi ${input.issuedTo},`,
    '',
    'You requested a free 1-year Lingua Pro Education plan. Click the link',
    'below to confirm — once confirmed, we will email you the license token:',
    '',
    input.confirmLink,
    '',
    'This link expires in 24 hours and can only be used once.',
  ].join('\n');
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: 'Confirm your Lingua Education plan',
    html,
    text,
    fetchImpl: input.fetchImpl,
  });
}

export interface SendEducationTokenEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  token: string;
  issuedTo: string;
  expiresAt: number;
  deepLink: string;
  fetchImpl?: typeof fetch;
}

export async function sendEducationTokenEmail(
  input: SendEducationTokenEmailInput
): Promise<ResendResult> {
  const html = renderEmailFromTemplate(educationTokenTemplate, {
    issuedTo: escapeHtml(input.issuedTo),
    token: escapeHtml(input.token),
    expiresOn: formatExpiresOn(input.expiresAt),
    deepLink: input.deepLink,
  });
  const text = [
    `Hi ${input.issuedTo},`,
    '',
    'Your Lingua Pro Education plan is active. Paste the token below into',
    'Settings → License inside the app:',
    '',
    input.token,
    '',
    `Plan expires on ${formatExpiresOn(input.expiresAt)}.`,
  ].join('\n');
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: 'Your Lingua Education plan is active',
    html,
    text,
    fetchImpl: input.fetchImpl,
  });
}

export interface SendEducationRenewalEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  token: string;
  issuedTo: string;
  expiresAt: number;
  fetchImpl?: typeof fetch;
}

export async function sendEducationRenewalEmail(
  input: SendEducationRenewalEmailInput
): Promise<ResendResult> {
  const html = renderEmailFromTemplate(educationRenewalTemplate, {
    issuedTo: escapeHtml(input.issuedTo),
    token: escapeHtml(input.token),
    expiresOn: formatExpiresOn(input.expiresAt),
  });
  const text = [
    `Hi ${input.issuedTo},`,
    '',
    'Your Lingua Pro Education plan has been renewed for another year.',
    'Lingua will pick up the refreshed token automatically the next time the',
    'app is online. If you need it manually, here it is:',
    '',
    input.token,
    '',
    `New expiry: ${formatExpiresOn(input.expiresAt)}.`,
  ].join('\n');
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: 'Your Lingua Education plan is renewed',
    html,
    text,
    fetchImpl: input.fetchImpl,
  });
}

export interface SendRecoveryConfirmationEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  confirmLink: string;
  fetchImpl?: typeof fetch;
}

export async function sendRecoveryConfirmationEmail(
  input: SendRecoveryConfirmationEmailInput
): Promise<ResendResult> {
  const html = renderEmailFromTemplate(recoveryConfirmationTemplate, {
    confirmLink: input.confirmLink,
  });
  const text = [
    'Someone requested to resend a Lingua license token to this email.',
    'If that was you, click the link below to confirm — we will then email',
    'you the latest token for the matching license:',
    '',
    input.confirmLink,
    '',
    'This link expires in 24 hours and can only be used once.',
    'If this was not you, ignore this email — nothing changes until the',
    'link is clicked.',
  ].join('\n');
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: 'Confirm your Lingua license recovery',
    html,
    text,
    fetchImpl: input.fetchImpl,
  });
}

export interface SendRecoveryTokenEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  token: string;
  issuedTo: string;
  tier: SendLicenseEmailInput['tier'];
  expiresAt: number | null;
  supportWindowEndsAt: number | null;
  deepLink: string;
  fetchImpl?: typeof fetch;
}

export async function sendRecoveryTokenEmail(
  input: SendRecoveryTokenEmailInput
): Promise<ResendResult> {
  const tierLabel = TIER_HUMAN[input.tier];
  const expiresOn = input.expiresAt === null ? 'No expiry (lifetime)' : formatExpiresOn(input.expiresAt);
  const planDetails =
    input.tier === 'pro_lifetime'
      ? lifetimeUpdateTerms(input.supportWindowEndsAt)
      : `Valid until: ${expiresOn}.`;
  const html = renderEmailFromTemplate(recoveryTokenTemplate, {
    issuedTo: escapeHtml(input.issuedTo),
    token: escapeHtml(input.token),
    tier: escapeHtml(tierLabel),
    planDetails: escapeHtml(planDetails),
    deepLink: input.deepLink,
  });
  const text = [
    `Hi ${input.issuedTo},`,
    '',
    'Here is the current license token for your account:',
    '',
    input.token,
    '',
    `Plan: ${tierLabel}. ${planDetails}`,
  ].join('\n');
  return postToResend({
    to: input.to,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    apiKey: input.apiKey,
    subject: 'Your Lingua license token',
    html,
    text,
    fetchImpl: input.fetchImpl,
  });
}

/**
 * Minimal Resend HTTP client.
 *
 * One function — `sendLicenseEmail` — that POSTs to the Resend API
 * with the buyer's email + the freshly minted license token. No SDK
 * dependency: keeps the worker bundle small and avoids a fetch-shim
 * compatibility surface.
 *
 * Failure modes:
 *   - `RESEND_API_KEY` not set → no-op `{ ok: false, reason: 'no-api-key' }`.
 *     Slice 2 webhook handler logs this but still returns 200 to Polar
 *     so the license persistence in D1 isn't undone by an email-only
 *     failure (Polar would retry the whole webhook and we'd hit a
 *     UNIQUE constraint).
 *   - Resend API 4xx/5xx → `{ ok: false, reason: 'api-error', status }`.
 *     Same logic — log + 200 ack to Polar.
 *   - Network error → `{ ok: false, reason: 'network-error' }`.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type ResendFailure =
  | { ok: false; reason: 'no-api-key' }
  | { ok: false; reason: 'api-error'; status: number; message?: string }
  | { ok: false; reason: 'network-error'; message: string };

export type ResendResult = { ok: true; id: string } | ResendFailure;

export interface SendLicenseEmailInput {
  to: string;
  fromEmail: string;
  fromName: string;
  apiKey: string | undefined;
  licenseToken: string;
  tier: 'pro' | 'pro_lifetime' | 'team' | 'trial' | 'education';
  productId: string;
  /** Override fetch for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

const TIER_HUMAN: Record<SendLicenseEmailInput['tier'], string> = {
  pro: 'Lingua Pro Monthly',
  pro_lifetime: 'Lingua Pro Lifetime',
  team: 'Lingua Team',
  trial: 'Lingua Trial',
  education: 'Lingua Education',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal HTML email body. No images, no remote assets, no tracking
 * pixels — keeps deliverability high and avoids spam filters that
 * downrank tracked email. Inline styling only because some clients
 * (Outlook, mobile webmail) ignore <style> blocks.
 */
function buildHtmlBody(token: string, productLabel: string): string {
  const safeToken = escapeHtml(token);
  const safeLabel = escapeHtml(productLabel);
  return [
    '<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#0a0a0f;background:#f7f7f9;padding:24px;">',
    `<h1 style="font-size:18px;margin:0 0 16px 0;">Welcome to ${safeLabel}.</h1>`,
    '<p style="margin:0 0 16px 0;">Your Lingua license is ready. Paste the token below into the app under <strong>Settings → License → Paste a license token</strong>.</p>',
    `<pre style="background:#0a0a0f;color:#e7e7ec;padding:16px;border-radius:8px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all;">${safeToken}</pre>`,
    '<p style="margin:16px 0 0 0;font-size:13px;color:#6b6b76;">Tokens are tied to your email and a max of 3 desktops + 3 browsers per license. Manage devices any time from <strong>Settings → License</strong>.</p>',
    '<p style="margin:16px 0 0 0;font-size:13px;color:#6b6b76;">Lost this email? Re-request the token from <strong>Settings → License → Lost your license?</strong> any time.</p>',
    '</body></html>',
  ].join('');
}

function buildTextBody(token: string, productLabel: string): string {
  return [
    `Welcome to ${productLabel}.`,
    '',
    'Your Lingua license is ready. Paste the token below into the app under',
    'Settings → License → Paste a license token.',
    '',
    token,
    '',
    'Tokens are tied to your email and a max of 3 desktops + 3 browsers per',
    'license. Manage devices any time from Settings → License.',
    '',
    'Lost this email? Re-request the token from Settings → License → Lost',
    'your license? any time.',
  ].join('\n');
}

export async function sendLicenseEmail(input: SendLicenseEmailInput): Promise<ResendResult> {
  if (!input.apiKey || input.apiKey.length === 0) {
    return { ok: false, reason: 'no-api-key' };
  }
  const productLabel = TIER_HUMAN[input.tier];
  const subject = `Your ${productLabel} license`;
  const body = {
    from: `${input.fromName} <${input.fromEmail}>`,
    to: [input.to],
    subject,
    html: buildHtmlBody(input.licenseToken, productLabel),
    text: buildTextBody(input.licenseToken, productLabel),
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
    // No id in response; Resend usually returns one but we don't depend on it.
  }
  return { ok: true, id: id ?? 'unknown' };
}

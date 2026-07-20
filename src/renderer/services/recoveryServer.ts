/**
 * Renderer-side wrapper for `POST /licenses/recover/start`
 * (implementation — magic-link recovery flow).
 *
 * The worker is no-info-leak: it ALWAYS responds with the same
 * pending shape regardless of whether the email matches a known
 * license, hits a rate-limit, or is empty (per LICENSING_ADR
 * Decision 7). The renderer mirrors that shape — we never
 * surface differential UX based on whether the email exists.
 *
 * `GET /licenses/recover/confirm` is intentionally NOT wrapped —
 * the user reaches it by clicking the email link, the renderer
 * never calls it.
 */

import type {
  LicenseRecoverInput,
  LicenseRecoverResult,
  LicenseRecoverPending,
  LicenseRecoverFailureReason,
} from '../../shared/licenseServerTypes';
import { validateLicenseServerProtocol } from '../../shared/licenseServerProtocol';

export type {
  LicenseRecoverInput,
  LicenseRecoverResult,
  LicenseRecoverPending,
  LicenseRecoverFailureReason,
} from '../../shared/licenseServerTypes';

const REQUEST_TIMEOUT_MS = 5000;

function getBaseUrl(): string | null {
  const raw = import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length === 0 ? null : trimmed;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<{ ok: true; response: Response } | { ok: false; reason: 'unreachable'; message?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      message: error instanceof Error ? error.message : 'fetch failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapRecoverReason(raw: unknown): LicenseRecoverFailureReason {
  if (typeof raw !== 'string') return 'server-error';
  switch (raw) {
    case 'invalid-input':
      return 'invalid-input';
    default:
      return 'server-error';
  }
}

export async function startRecovery(
  input: LicenseRecoverInput,
): Promise<LicenseRecoverResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const result = await fetchWithTimeout(`${base}/licenses/recover/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response } = result;
  // Recovery is no-info-leak only after the response proves it speaks the
  // contract this client understands.
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }
  if (response.ok && body && body.ok === true && body.pending === true) {
    return body as unknown as LicenseRecoverPending;
  }

  const reason = mapRecoverReason(body?.reason);
  return {
    ok: false,
    reason,
    message: typeof body?.message === 'string' ? body.message : undefined,
  };
}

/**
 * Renderer-side wrappers for the implementation Education flow.
 *
 *   POST /education/start  — magic-link first step. Body returns
 *                            { ok: true, pending: true, message }
 *                            on success. Renderer shows a "check
 *                            your email" notice; the actual token
 *                            arrives after the user clicks the
 *                            confirm link.
 *   POST /education/renew  — re-mints + extends 1y. Token returned
 *                            in `refreshedToken` for auto-pickup.
 *
 * `GET /education/confirm` is intentionally NOT wrapped — the user
 * reaches it by clicking the email link, so the renderer never
 * calls it.
 */

import type {
  EducationStartInput,
  EducationStartResult,
  EducationStartPending,
  EducationStartFailureReason,
  EducationRenewInput,
  EducationRenewResult,
  EducationRenewSuccess,
  EducationRenewFailureReason,
} from '../../shared/licenseServerTypes';

export type {
  EducationStartInput,
  EducationStartResult,
  EducationStartPending,
  EducationStartFailureReason,
  EducationRenewInput,
  EducationRenewResult,
  EducationRenewSuccess,
  EducationRenewFailureReason,
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

function readIssues(body: Record<string, unknown> | null): string[] | undefined {
  const raw = body?.issues;
  if (!Array.isArray(raw)) return undefined;
  const filtered = raw.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? filtered : undefined;
}

function mapStartReason(raw: unknown): EducationStartFailureReason {
  if (typeof raw !== 'string') return 'server-error';
  switch (raw) {
    case 'invalid-input':
    case 'not-educational':
    case 'education-unavailable':
    case 'rate-limited':
    case 'confirmation-email-failed':
    case 'not-implemented':
      return raw;
    default:
      return 'server-error';
  }
}

function mapRenewReason(raw: unknown): EducationRenewFailureReason {
  if (typeof raw !== 'string') return 'server-error';
  switch (raw) {
    case 'invalid-input':
    case 'not-educational':
    case 'unknown-license':
    case 'email-mismatch':
    case 'not-implemented':
      return raw;
    default:
      return 'server-error';
  }
}

export async function startEducation(
  input: EducationStartInput,
): Promise<EducationStartResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const result = await fetchWithTimeout(`${base}/education/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response } = result;
  const body = (await readJson(response)) as Record<string, unknown> | null;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }
  if (response.ok && body && body.ok === true && body.pending === true) {
    return body as unknown as EducationStartPending;
  }

  const reason = mapStartReason(body?.reason);
  const issues = readIssues(body);
  return {
    ok: false,
    reason,
    message: typeof body?.message === 'string' ? body.message : undefined,
    issues,
    canRecover: body?.canRecover === true ? true : undefined,
    retryAfter: typeof body?.retryAfter === 'number' ? body.retryAfter : undefined,
  };
}

export async function renewEducation(
  input: EducationRenewInput,
): Promise<EducationRenewResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const result = await fetchWithTimeout(`${base}/education/renew`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response } = result;
  const body = (await readJson(response)) as Record<string, unknown> | null;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }
  if (response.ok && body && body.ok === true) {
    return body as unknown as EducationRenewSuccess;
  }

  const reason = mapRenewReason(body?.reason);
  const issues = readIssues(body);
  return {
    ok: false,
    reason,
    message: typeof body?.message === 'string' ? body.message : undefined,
    issues,
  };
}

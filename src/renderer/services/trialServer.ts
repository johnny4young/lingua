/**
 * Renderer-side wrapper for `POST /trials/start` (RL-061 Slice 4).
 *
 * Mirrors the conventions in `licenseServer.ts`:
 *   - reads the base URL from `import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL`
 *   - returns a tagged-union; never throws
 *   - 5s timeout via `AbortController`; no retry
 *   - network / parse errors collapse to `unreachable`
 *
 * The success branch returns the signed token in the body so the
 * caller can feed it directly into `licenseStore.setLicenseToken`
 * for auto-paste — even if the welcome email failed to send.
 */

import type {
  TrialStartInput,
  TrialStartResult,
  TrialStartSuccess,
  TrialStartFailureReason,
} from '../../shared/licenseServerTypes';

export type {
  TrialStartInput,
  TrialStartResult,
  TrialStartSuccess,
  TrialStartFailureReason,
} from '../../shared/licenseServerTypes';

const REQUEST_TIMEOUT_MS = 5000;

function getBaseUrl(): string | null {
  const raw = import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length === 0 ? null : trimmed;
}

function mapTrialReason(raw: unknown): TrialStartFailureReason {
  if (typeof raw !== 'string') return 'server-error';
  switch (raw) {
    case 'invalid-input':
    case 'trial-unavailable':
    case 'rate-limited':
    case 'not-implemented':
      return raw;
    default:
      return 'server-error';
  }
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

export async function startTrial(input: TrialStartInput): Promise<TrialStartResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const result = await fetchWithTimeout(`${base}/trials/start`, {
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

  // 200 ok=true → trial minted. 200 ok=false → duplicate-email /
  // duplicate-device branch. The worker uses 200 + ok:false for
  // "duplicate" so the renderer can surface a notice without
  // treating it as a hard error.
  if (response.ok && body && body.ok === true) {
    return body as unknown as TrialStartSuccess;
  }

  const reason = mapTrialReason(body?.reason);
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

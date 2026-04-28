/**
 * Thin fetch wrappers for the RL-061 license-server endpoints.
 *
 * The web build calls these to enforce the split-bucket device limit
 * (3 desktop + 3 web concurrent activations per license, per
 * LICENSING_ADR Decision 4) and to pick up Monthly subscription
 * `refreshedToken` updates when the worker re-mints
 * `licenses.token` after a paid `order.paid` renewal.
 *
 * Desktop renderer never calls these — it goes through the
 * `window.lingua.license.*` IPC bridge which the main process owns.
 *
 * All wrappers:
 *   - read the base URL from `import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL`
 *   - return a tagged-union `{ ok: true, ... } | { ok: false, reason, message? }`
 *   - never throw; network errors and parse errors map to `unreachable`
 *     so callers can implement the 24-hour offline-grace fallback
 *   - apply a 5-second timeout via `AbortController`; no retry
 *
 * `removeDevice` uses `keepalive: true` so a fast tab close still
 * completes the request — clearing a license should always reach the
 * server even if the user immediately closes the tab.
 */

const REQUEST_TIMEOUT_MS = 5000;

export type LicenseServerSurface = 'desktop' | 'web';

export interface LicenseServerDevice {
  id: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: LicenseServerSurface;
  activatedAt: number;
  lastSeenAt: number;
}

export interface LicenseServerDevicesBucket {
  desktop: LicenseServerDevice[];
  web: LicenseServerDevice[];
}

export interface LicenseServerDeviceLimit {
  desktop: number;
  web: number;
}

export type LicenseServerStatusKind =
  | 'active'
  | 'grace'
  | 'expired'
  | 'cancel_at_period_end'
  | 'refunded';

export type LicenseServerFailureReason =
  /** `VITE_LINGUA_LICENSE_SERVER_URL` is empty — the build is local-verify-only. */
  | 'disabled'
  /** Network error, timeout, DNS failure, CORS, etc. The 24-hour offline-grace fallback applies. */
  | 'unreachable'
  /** Worker returned 5xx or a body shape we don't recognise. Treat as transient. */
  | 'server-error'
  /** Token signature didn't verify against the server's public key. */
  | 'invalid-signature'
  /** Token was valid but no row in D1 — typically a token signed by a non-production key. */
  | 'unknown-license'
  /** Order was refunded after issuance. License row is permanently invalid. */
  | 'revoked'
  /** Subscription expired past the grace window. */
  | 'expired'
  /** Per-surface bucket is full. Caller should surface the device list to the user (Slice 3). */
  | 'exhausted'
  /** Body shape didn't pass server-side validation (e.g. missing fields, bad surface). */
  | 'invalid-input'
  /** Worker is missing a critical secret (e.g. LINGUA_LICENSE_PUBLIC_KEY_JWK). */
  | 'not-implemented';

export interface ActivateInput {
  token: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: LicenseServerSurface;
}

export interface ActivateSuccess {
  ok: true;
  licenseId: string;
  activated: boolean;
  idempotent: boolean;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
}

export interface ExhaustedFailure {
  ok: false;
  reason: 'exhausted';
  surface: LicenseServerSurface;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
}

export type ActivateResult =
  | ActivateSuccess
  | ExhaustedFailure
  | { ok: false; reason: Exclude<LicenseServerFailureReason, 'exhausted'>; message?: string };

export interface StatusInput {
  token: string;
  deviceId: string;
  surface: LicenseServerSurface;
}

export interface StatusSuccess {
  ok: true;
  licenseId: string;
  status: LicenseServerStatusKind;
  tier: string;
  expiresAt: number | null;
  supportWindowEndsAt: number;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
  deviceRegistered: boolean;
  /** Present when the persisted `licenses.token` differs from the one the client sent (Monthly renewal pickup). */
  refreshedToken?: string;
}

export type StatusResult =
  | StatusSuccess
  | { ok: false; reason: LicenseServerFailureReason; message?: string };

export interface RemoveDeviceInput {
  token: string;
  deviceIdToRemove: string;
}

export interface RemoveDeviceSuccess {
  ok: true;
  licenseId: string;
  removed: boolean;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
}

export type RemoveDeviceResult =
  | RemoveDeviceSuccess
  | { ok: false; reason: LicenseServerFailureReason; message?: string };

function getBaseUrl(): string | null {
  const raw = import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Map the server's `reason` strings (per
 * `license-server/src/handlers/licenses.ts`) onto our renderer-side
 * union. Anything we don't recognise falls back to `server-error`
 * so a misshapen response never crashes the caller.
 */
function mapServerReason(raw: unknown): LicenseServerFailureReason {
  if (typeof raw !== 'string') return 'server-error';
  switch (raw) {
    case 'invalid-signature':
    case 'invalid-token':
      return 'invalid-signature';
    case 'unknown-license':
      return 'unknown-license';
    case 'license-refunded':
      return 'revoked';
    case 'license-expired':
      return 'expired';
    case 'exhausted':
      return 'exhausted';
    case 'invalid-input':
      return 'invalid-input';
    case 'not-implemented':
      return 'not-implemented';
    default:
      return 'server-error';
  }
}

/**
 * Run a fetch with a 5-second AbortController timeout. Treats
 * network errors, timeouts, and abort as `unreachable` so callers
 * can fall back to the local-verify path without distinguishing
 * the underlying cause.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit
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

// ------------------------------------------------------------------ activate

export async function activate(input: ActivateInput): Promise<ActivateResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const result = await fetchWithTimeout(`${base}/licenses/activate`, {
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

  // 200 ok=true → activated or idempotent. 200 ok=false → exhausted.
  if (response.ok && body && body.ok === true) {
    return body as unknown as ActivateSuccess;
  }
  if (response.ok && body && body.ok === false && body.reason === 'exhausted') {
    return body as unknown as ExhaustedFailure;
  }

  // 4xx with the worker's tagged reason field.
  const reason = mapServerReason(body?.reason);
  if (reason === 'exhausted') {
    // Defensive: the only way to reach this branch is a 4xx with reason
    // 'exhausted', which the worker never emits, but the type system
    // wants the exhaustive return so we keep it tight.
    return { ok: false, reason: 'server-error', message: 'unexpected exhausted on non-200' };
  }
  return { ok: false, reason, message: typeof body?.message === 'string' ? body.message : undefined };
}

// -------------------------------------------------------------------- status

export async function status(input: StatusInput): Promise<StatusResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const params = new URLSearchParams({ deviceId: input.deviceId, surface: input.surface });
  const result = await fetchWithTimeout(`${base}/licenses/status?${params.toString()}`, {
    method: 'GET',
    headers: {
      // Token in Authorization header NEVER in the URL query — CF
      // logs capture query params verbatim, so a token in `?token=…`
      // would persist in the worker's audit log.
      Authorization: `Bearer ${input.token}`,
    },
  });
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response } = result;
  const body = (await readJson(response)) as Record<string, unknown> | null;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return body as unknown as StatusSuccess;
  }

  const reason = mapServerReason(body?.reason);
  return { ok: false, reason, message: typeof body?.message === 'string' ? body.message : undefined };
}

// ------------------------------------------------------------- removeDevice

export async function removeDevice(input: RemoveDeviceInput): Promise<RemoveDeviceResult> {
  const base = getBaseUrl();
  if (!base) return { ok: false, reason: 'disabled' };

  const result = await fetchWithTimeout(`${base}/licenses/devices/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: input.token, deviceIdToRemove: input.deviceIdToRemove }),
    // Survive a fast tab close — `clearLicense` fires this and then
    // immediately wipes localStorage; without keepalive a navigation
    // race would cancel the in-flight request and leave a dangling
    // device row in D1.
    keepalive: true,
  });
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response } = result;
  const body = (await readJson(response)) as Record<string, unknown> | null;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return body as unknown as RemoveDeviceSuccess;
  }

  const reason = mapServerReason(body?.reason);
  return { ok: false, reason, message: typeof body?.message === 'string' ? body.message : undefined };
}

/**
 * `true` when the build is configured to talk to the license-server.
 * Renderer code reads this to gate behaviour the desktop bridge would
 * otherwise own (e.g. don't auto-revalidate on rehydrate when there
 * is no server).
 */
export function isLicenseServerEnabled(): boolean {
  return getBaseUrl() !== null;
}

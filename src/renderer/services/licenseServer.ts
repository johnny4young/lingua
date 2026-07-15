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
 * Slice 3.5 ships the parallel main-side implementation in
 * `src/main/licenseServer.ts`; both sides import their request /
 * response types from `src/shared/licenseServerTypes.ts` so the
 * contract cannot drift.
 *
 * All wrappers:
 *   - read the base URL from `import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL`
 *   - return a tagged-union `{ ok: true, ... } | { ok: false, reason, message? }`
 *   - never throw; network errors map to `unreachable`, while malformed or
 *     unversioned responses fail closed as `unsupported-protocol`
 *   - apply a 5-second timeout via `AbortController`; no retry
 *
 * `removeDevice` uses `keepalive: true` so a fast tab close still
 * completes the request — clearing a license should always reach the
 * server even if the user immediately closes the tab.
 */

import type {
  ActivateInput,
  ActivateResult,
  ActivateSuccess,
  ExhaustedFailure,
  LicenseServerFailureReason,
  RemoveDeviceInput,
  RemoveDeviceResult,
  RemoveDeviceSuccess,
  StatusInput,
  StatusResult,
  StatusSuccess,
} from '../../shared/licenseServerTypes';
import {
  stripProtocolEnvelope,
  validateLicenseServerProtocol,
} from '../../shared/licenseServerProtocol';

// Re-export so existing renderer imports
// (`from '../services/licenseServer'`) keep working unchanged.
export type {
  ActivateInput,
  ActivateResult,
  ActivateSuccess,
  ExhaustedFailure,
  LicenseServerDevice,
  LicenseServerDeviceLimit,
  LicenseServerDevicesBucket,
  LicenseServerFailureReason,
  LicenseServerStatusKind,
  LicenseServerSurface,
  RemoveDeviceInput,
  RemoveDeviceResult,
  RemoveDeviceSuccess,
  ServerFailureMeta,
  StatusInput,
  StatusResult,
  StatusSuccess,
} from '../../shared/licenseServerTypes';

const REQUEST_TIMEOUT_MS = 5000;

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

/**
 * Pull the `issues` array off a worker error response when present.
 * The worker validator (`license-server/src/lib/validation.ts`) emits
 * `{ ok: false, reason: 'invalid-input', issues: [...] }` on shape
 * violations. The renderer surfaces a translated user-facing notice
 * separately; the issues themselves are developer-detail.
 */
function readIssues(body: Record<string, unknown> | null): string[] | undefined {
  const raw = body?.issues;
  if (!Array.isArray(raw)) return undefined;
  const filtered = raw.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Loud diagnostics for `invalid-input` responses. The renderer should
 * never produce a request body that fails the worker's validator —
 * if it does, the contract between renderer (`deviceFingerprint.ts`)
 * and worker (`validation.ts`) has drifted and we want to know
 * immediately. Console.warn instead of console.error so the message
 * does not crash the FirstRun consent test that asserts a clean
 * console at boot.
 */
function warnOnInvalidInput(endpoint: string, reason: LicenseServerFailureReason, issues: string[] | undefined): void {
  if (reason !== 'invalid-input') return;
  console.warn(
    `[lingua-license] ${endpoint} rejected with invalid-input. issues: ${issues?.join(' | ') ?? '(none)'}. ` +
      'Renderer ↔ worker validator may be out of sync; check src/renderer/services/deviceFingerprint.ts ' +
      'against license-server/src/lib/validation.ts.'
  );
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
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  // 200 ok=true → activated or idempotent. 200 ok=false → exhausted.
  if (response.ok && body && body.ok === true) {
    return stripProtocolEnvelope(body) as unknown as ActivateSuccess;
  }
  if (response.ok && body && body.ok === false && body.reason === 'exhausted') {
    return stripProtocolEnvelope(body) as unknown as ExhaustedFailure;
  }

  // 4xx with the worker's tagged reason field.
  const reason = mapServerReason(body?.reason);
  if (reason === 'exhausted') {
    // Defensive: the only way to reach this branch is a 4xx with reason
    // 'exhausted', which the worker never emits, but the type system
    // wants the exhaustive return so we keep it tight.
    return { ok: false, reason: 'server-error', message: 'unexpected exhausted on non-200' };
  }
  const issues = readIssues(body);
  warnOnInvalidInput('/licenses/activate', reason, issues);
  return {
    ok: false,
    reason,
    message: typeof body?.message === 'string' ? body.message : undefined,
    issues,
  };
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
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return stripProtocolEnvelope(body) as unknown as StatusSuccess;
  }

  const reason = mapServerReason(body?.reason);
  const issues = readIssues(body);
  warnOnInvalidInput('/licenses/status', reason, issues);
  return {
    ok: false,
    reason,
    message: typeof body?.message === 'string' ? body.message : undefined,
    issues,
  };
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
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return stripProtocolEnvelope(body) as unknown as RemoveDeviceSuccess;
  }

  const reason = mapServerReason(body?.reason);
  const issues = readIssues(body);
  warnOnInvalidInput('/licenses/devices/remove', reason, issues);
  return {
    ok: false,
    reason,
    message: typeof body?.message === 'string' ? body.message : undefined,
    issues,
  };
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

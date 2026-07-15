/**
 * Main-side fetch wrappers for the RL-061 license-server endpoints
 * (Slice 3.5).
 *
 * Mirror of `src/renderer/services/licenseServer.ts` for the desktop
 * build: same canonical request / response types (imported from
 * `src/shared/licenseServerTypes.ts`), same tagged-union failure
 * shape, same 5-second AbortController timeout, same `disabled` /
 * `unreachable` / `server-error` triage. Differences from the
 * renderer wrappers:
 *
 * - Base URL comes from the build-time `__LINGUA_LICENSE_SERVER_URL__`
 *   define in `vite.main.config.mts` (loaded via `loadEnv()` from
 *   `.env.production`), with `process.env.LINGUA_LICENSE_SERVER_URL`
 *   as a runtime override for dev launchers
 *   (`scripts/dev-desktop-prod.mjs` etc.).
 * - Uses Node 22+ global `fetch`. Electron 30+ ships Node 22 with
 *   fetch as a global; the defensive `typeof fetch === 'function'`
 *   guard keeps an older bundle from crashing — it falls back to
 *   `disabled` so the renderer's local-verify path stays in charge.
 * - No `keepalive: true` — main runs in a long-lived process, the
 *   browser tab-close edge case the renderer worries about cannot
 *   happen here.
 *
 * Slice 3.5 callers (`src/main/license.ts`):
 *   - `applyToken` runs `serverActivate` after a successful local
 *     verify so the desktop bucket in D1 stays accurate.
 *   - `revalidate` runs `serverStatus` and re-issues `serverActivate`
 *     when `deviceRegistered: false` so a rehydrated exhausted token
 *     cannot bypass the per-surface cap.
 *   - `removeDevice` exposes `/licenses/devices/remove` to the IPC
 *     bridge so the renderer's Devices section can act on desktop
 *     too.
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
} from '../shared/licenseServerTypes';
import { validateLicenseServerProtocol } from '../shared/licenseServerProtocol';

// Re-export so `src/main/license.ts` can import from one place
// (the runtime + the wrappers stay siblings under src/main).
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
  LicenseServerSyncState,
  RemoveDeviceInput,
  RemoveDeviceResult,
  RemoveDeviceSuccess,
  ServerFailureMeta,
  StatusInput,
  StatusResult,
  StatusSuccess,
} from '../shared/licenseServerTypes';

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Build-time substitution from `vite.main.config.mts` — the
 * `loadEnv()` call there pulls `LINGUA_LICENSE_SERVER_URL` (or its
 * VITE_ alias) out of repo-root `.env.production` and bakes the
 * literal string into the bundle. Empty string means "no server
 * configured", which the wrappers surface as `disabled`.
 */
declare const __LINGUA_LICENSE_SERVER_URL__: string;

function getBaseUrl(): string | null {
  // Runtime override wins over the baked-in value so the dev
  // launchers (`scripts/dev-desktop-prod.mjs`,
  // `scripts/dev-desktop-pro.mjs`) can point at a localhost mock
  // without having to rebuild main. Also keeps the `dev:desktop`
  // (no env var) path strictly local-verify-only.
  const candidates = [
    typeof process !== 'undefined' ? process.env?.LINGUA_LICENSE_SERVER_URL : undefined,
    typeof __LINGUA_LICENSE_SERVER_URL__ !== 'undefined' ? __LINGUA_LICENSE_SERVER_URL__ : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim().replace(/\/$/, '');
    if (trimmed.length === 0) continue;
    if (!isAllowedLicenseServerUrl(trimmed)) continue;
    return trimmed;
  }
  return null;
}

/**
 * `status()` sends the signed license token as an `Authorization: Bearer`
 * header, and this fetch runs in main — the renderer CSP does not apply
 * here. Enforce HTTPS so a misconfigured build/env var can never leak the
 * token over cleartext; loopback hosts stay allowed for the dev launchers
 * that point at a localhost mock.
 */
function isAllowedLicenseServerUrl(candidate: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  return (
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]' ||
    parsed.hostname === '::1'
  );
}

/**
 * Map the worker's `reason` strings (per
 * `license-server/src/handlers/licenses.ts`) onto the canonical
 * `LicenseServerFailureReason` union. Anything unrecognised falls
 * back to `server-error` so a misshapen response never crashes the
 * caller.
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
 * can fall back to the local-verify path. Defensive `typeof fetch`
 * check covers the unlikely case of an Electron version older than
 * Node 22 where `fetch` is not a global — bundle stays usable in
 * local-verify-only mode rather than crashing.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit
): Promise<{ ok: true; response: Response } | { ok: false; reason: 'unreachable' | 'disabled'; message?: string }> {
  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'disabled', message: 'global fetch is not available in this runtime' };
  }
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

/**
 * Loud diagnostics for `invalid-input` responses on the main side.
 * If the desktop client produces a request body the worker validator
 * rejects, the contract between `src/main/license.ts:resolveDeviceMetadata`
 * (which feeds `os` + `deviceName`) and
 * `license-server/src/lib/validation.ts` has drifted. Same shape as
 * the renderer's warning so the message is searchable across both
 * surfaces in production logs.
 */
function warnOnInvalidInput(
  endpoint: string,
  reason: LicenseServerFailureReason,
  issues: string[] | undefined
): void {
  if (reason !== 'invalid-input') return;
  console.warn(
    `[lingua-license][main] ${endpoint} rejected with invalid-input. issues: ${issues?.join(' | ') ?? '(none)'}. ` +
      'Renderer/main ↔ worker validator may be out of sync; check src/main/license.ts ' +
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
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  const { response } = result;
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return body as unknown as ActivateSuccess;
  }
  if (response.ok && body && body.ok === false && body.reason === 'exhausted') {
    return body as unknown as ExhaustedFailure;
  }

  const reason = mapServerReason(body?.reason);
  if (reason === 'exhausted') {
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
      // Token in Authorization header — never in the URL query — for
      // the same reason the renderer wrapper does it: CF Workers
      // observability captures query params verbatim, and a token in
      // `?token=...` would persist in the worker's audit log.
      Authorization: `Bearer ${input.token}`,
    },
  });
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  const { response } = result;
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return body as unknown as StatusSuccess;
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
  });
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  const { response } = result;
  const protocol = validateLicenseServerProtocol(await readJson(response));
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;

  if (response.status >= 500) {
    return { ok: false, reason: 'server-error', message: `HTTP ${response.status}` };
  }

  if (response.ok && body && body.ok === true) {
    return body as unknown as RemoveDeviceSuccess;
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
 * `src/main/license.ts` reads this to gate behaviour the local-verify
 * path would otherwise skip (e.g. don't try to register a device when
 * there is no server, don't auto-revalidate on rehydrate).
 */
export function isLicenseServerEnabled(): boolean {
  return getBaseUrl() !== null;
}

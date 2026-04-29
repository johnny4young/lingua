/**
 * Main-side license runtime (RL-059 Slice 0).
 *
 * Owns the desktop build's license + device-id persistence so packaged
 * apps can verify entitlement without depending on the renderer's
 * `localStorage`. The renderer treats this module as the source of truth
 * via the IPC bridge in `src/main/ipc/license.ts` and the preload surface
 * in `src/preload/index.ts`.
 *
 * Persistence layout under `app.getPath('userData')`:
 * - `license.json`  — { token, lastVerifiedAt }; absent when free
 * - `device-id.json` — { deviceId, createdAt }; written once on first launch
 *
 * Both writes are atomic (tmp + rename, mode 0o600 on POSIX) using the
 * same pattern as `src/main/ipc/consent.ts`. Reads default to a safe
 * sentinel — never throw — so a corrupt file never upgrades the app
 * into a wrongly-active state.
 */

import { chmod, copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hostname, platform as osPlatform } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  type LicenseVerificationResult,
  verifyLicenseToken,
} from '../shared/license';
import {
  activate as serverActivate,
  isLicenseServerEnabled,
  removeDevice as serverRemoveDevice,
  status as serverStatus,
  type ActivateResult,
  type LicenseServerDeviceLimit,
  type LicenseServerDevicesBucket,
  type LicenseServerFailureReason,
  type LicenseServerSyncState,
  type LicenseServerStatusKind,
  type RemoveDeviceResult,
} from './licenseServer';

export type LicenseStatus =
  | { kind: 'free' }
  | { kind: 'invalid'; reason: string; message?: string }
  | { kind: 'active'; verification: Extract<LicenseVerificationResult, { ok: true }> }
  | { kind: 'grace'; verification: Extract<LicenseVerificationResult, { ok: true }> };

/**
 * Snapshot the IPC bridge ships to the renderer. Slice 3.5 extends it
 * with three server-derived fields so the renderer's desktop branch
 * can render the Devices section under the same gate the web build
 * already passes (`serverSync === 'synced'` + non-null `devices` +
 * `deviceLimit`).
 *
 * Persistence: `token` + `lastVerifiedAt` go to disk
 * (`userData/license.json`). `devices`, `deviceLimit`, and
 * `serverSync` are in-memory only — devices belong on the server, the
 * boot revalidate re-fetches them via `/licenses/status` so a stale
 * cache cannot drift past actual server state.
 */
export interface LicenseSnapshot {
  token: string | null;
  status: LicenseStatus;
  deviceId: string;
  lastVerifiedAt: number | null;
  serverSync: LicenseServerSyncState;
  devices: LicenseServerDevicesBucket | null;
  deviceLimit: LicenseServerDeviceLimit | null;
}

export const FREE_STATUS: LicenseStatus = { kind: 'free' };

export function resolveLicensePath(userDataDir: string): string {
  return path.join(userDataDir, 'license.json');
}

export function resolveDeviceIdPath(userDataDir: string): string {
  return path.join(userDataDir, 'device-id.json');
}

interface PersistedLicense {
  token: string;
  lastVerifiedAt: number;
}

interface PersistedDeviceId {
  deviceId: string;
  createdAt: number;
}

async function atomicWrite(filePath: string, payload: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
  if (process.platform !== 'win32') {
    await chmod(tmp, 0o600);
  }
  try {
    await rename(tmp, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // Windows can fail rename with EPERM when the target is held open by a
    // co-resident process (antivirus, indexer, the running Electron itself
    // re-reading on a different worker). Fall back to copyFile + unlink so
    // the user-initiated license write still lands. Cross-volume EXDEV
    // can't fire here — tmp is created next to filePath in userData.
    if (code === 'EPERM' || code === 'EBUSY') {
      try {
        await copyFile(tmp, filePath);
      } finally {
        await unlink(tmp).catch(() => {
          // Best-effort cleanup. A stale tmp is harmless — readers ignore it.
        });
      }
      return;
    }
    await unlink(tmp).catch(() => {
      // Best-effort cleanup. The original write failure is the one callers
      // need; a cleanup failure should not mask it.
    });
    throw error;
  }
}

export async function readPersistedLicense(filePath: string): Promise<PersistedLicense | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { token?: unknown; lastVerifiedAt?: unknown };
    if (
      typeof parsed.token === 'string' &&
      parsed.token.length > 0 &&
      typeof parsed.lastVerifiedAt === 'number' &&
      Number.isFinite(parsed.lastVerifiedAt)
    ) {
      return { token: parsed.token, lastVerifiedAt: parsed.lastVerifiedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function writePersistedLicense(
  filePath: string,
  value: PersistedLicense
): Promise<void> {
  const payload = JSON.stringify({
    token: value.token,
    lastVerifiedAt: value.lastVerifiedAt,
  }) + '\n';
  await atomicWrite(filePath, payload);
}

export async function clearPersistedLicense(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function loadOrCreateDeviceId(filePath: string): Promise<string> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { deviceId?: unknown };
    if (typeof parsed.deviceId === 'string' && parsed.deviceId.length > 0) {
      return parsed.deviceId;
    }
  } catch {
    // fall through and mint a fresh one
  }
  const fresh: PersistedDeviceId = {
    deviceId: randomUUID(),
    createdAt: Date.now(),
  };
  try {
    await atomicWrite(filePath, JSON.stringify(fresh) + '\n');
  } catch {
    // A missing or temporarily read-only userData directory must not block
    // app startup. The id will be ephemeral until a later launch can persist.
  }
  return fresh.deviceId;
}

export function parseEmbeddedPublicKey(raw: string | undefined | null): JsonWebKey | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    return null;
  }
}

function resultToStatus(result: LicenseVerificationResult): LicenseStatus {
  if (!result.ok) {
    return { kind: 'invalid', reason: result.reason, message: result.message };
  }
  return { kind: result.state === 'grace' ? 'grace' : 'active', verification: result };
}

async function runVerify(
  token: string,
  publicKeyJwk: JsonWebKey | null,
  now: number
): Promise<LicenseStatus> {
  if (!publicKeyJwk) {
    return {
      kind: 'invalid',
      reason: 'no-public-key',
      message:
        'Build does not embed a license public key. Set LINGUA_LICENSE_PUBLIC_KEY_JWK at build time.',
    };
  }
  const result = await verifyLicenseToken(token, publicKeyJwk, { now });
  return resultToStatus(result);
}

export interface LicenseRuntime {
  getSnapshot(): LicenseSnapshot;
  applyToken(token: string): Promise<LicenseStatus>;
  clear(): Promise<void>;
  revalidate(): Promise<LicenseStatus>;
  /**
   * Slice 3.5 — remove a device from the active license via the
   * server's `/licenses/devices/remove` endpoint and refresh the
   * cached bucket. Returns the wrapper's result so the IPC handler
   * can forward the success / failure shape unchanged. Returns
   * `not-implemented` when there is no token or no server URL — the
   * IPC handler maps that to the renderer's existing tagged-union
   * shape.
   */
  removeDevice(deviceIdToRemove: string): Promise<RemoveDeviceResult>;
}

export interface CreateLicenseRuntimeOptions {
  userDataDir: string;
  publicKeyJwk: JsonWebKey | null;
  /** Defaults to `Date.now`. Tests inject a deterministic clock. */
  now?: () => number;
  /**
   * Override `os.hostname()` + `process.platform` for tests. The
   * default reads them once at runtime construction so a renamed
   * machine on a long-lived process keeps the original device-name
   * in the activated bucket — matching what the web build does with
   * `navigator.userAgent` (snapshot at first paste).
   */
  deviceMetadata?: { deviceName: string; os: string };
}

/**
 * Default device metadata for the desktop bucket. `deviceName` seeds
 * from `os.hostname()` so a row in D1 reads as e.g. "Johnny's MBP" or
 * "build-server-01" — what the renderer shows in the Devices list
 * under Settings → License. `os` mirrors Node's `process.platform`
 * values (`darwin` / `win32` / `linux`) so the worker validator's
 * permissive shape check accepts it (post Slice 3 the validator no
 * longer pins to the desktop triple, but we stay in the canonical
 * vocabulary anyway).
 */
function defaultDeviceMetadata(): { deviceName: string; os: string } {
  let host: string;
  try {
    host = hostname() || 'desktop';
  } catch {
    host = 'desktop';
  }
  const trimmed = host.trim().slice(0, 64);
  return {
    deviceName: trimmed.length > 0 ? trimmed : 'desktop',
    os: osPlatform(),
  };
}

export async function createLicenseRuntime(
  options: CreateLicenseRuntimeOptions
): Promise<LicenseRuntime> {
  const licensePath = resolveLicensePath(options.userDataDir);
  const deviceIdPath = resolveDeviceIdPath(options.userDataDir);
  const now = options.now ?? Date.now;
  const deviceMetadata = options.deviceMetadata ?? defaultDeviceMetadata();

  const deviceId = await loadOrCreateDeviceId(deviceIdPath);
  const initialServerSync: LicenseServerSyncState = isLicenseServerEnabled() ? 'unreachable' : 'disabled';

  let cache: LicenseSnapshot = {
    token: null,
    status: FREE_STATUS,
    deviceId,
    lastVerifiedAt: null,
    serverSync: initialServerSync,
    devices: null,
    deviceLimit: null,
  };

  function freeSnapshot(at: number): LicenseSnapshot {
    return {
      token: null,
      status: FREE_STATUS,
      deviceId,
      lastVerifiedAt: at,
      serverSync: isLicenseServerEnabled() ? 'unreachable' : 'disabled',
      devices: null,
      deviceLimit: null,
    };
  }

  function isTransientFailure(reason: LicenseServerFailureReason): boolean {
    return reason === 'unreachable' || reason === 'server-error' || reason === 'not-implemented';
  }

  function failureToInvalid(reason: LicenseServerFailureReason): LicenseStatus | null {
    switch (reason) {
      case 'revoked':
        return { kind: 'invalid', reason: 'license-refunded' };
      case 'expired':
        return { kind: 'invalid', reason: 'expired' };
      case 'invalid-signature':
        return { kind: 'invalid', reason: 'invalid-signature' };
      case 'unknown-license':
        return { kind: 'invalid', reason: 'unknown-license' };
      case 'exhausted':
        return { kind: 'invalid', reason: 'devices-exhausted' };
      case 'invalid-input':
        return { kind: 'invalid', reason: 'invalid-input' };
      case 'unreachable':
      case 'server-error':
      case 'not-implemented':
      case 'disabled':
        return null;
      default: {
        const _exhaustive: never = reason;
        void _exhaustive;
        return null;
      }
    }
  }

  function serverStatusKindToStatus(
    kind: LicenseServerStatusKind,
    localStatus: LicenseStatus
  ): LicenseStatus {
    switch (kind) {
      case 'active':
      case 'cancel_at_period_end':
        if (localStatus.kind === 'active' || localStatus.kind === 'grace') {
          return { kind: 'active', verification: localStatus.verification };
        }
        return localStatus;
      case 'grace':
        if (localStatus.kind === 'active' || localStatus.kind === 'grace') {
          return { kind: 'grace', verification: localStatus.verification };
        }
        return localStatus;
      case 'expired':
        return { kind: 'invalid', reason: 'expired' };
      case 'refunded':
        return { kind: 'invalid', reason: 'license-refunded' };
      default: {
        const _exhaustive: never = kind;
        void _exhaustive;
        return localStatus;
      }
    }
  }

  /**
   * Run the post-local-verify activation handshake. Mirrors
   * `licenseStore.ts:setLicenseToken` on the web side: success
   * caches devices + deviceLimit + sets `synced`; transient failure
   * keeps the local-verify status with `serverSync='unreachable'`;
   * terminal failure flips to a discrete invalid status (token
   * preserved only on `exhausted` so the renderer's modal can
   * remediate). Returns the status the caller should propagate to
   * its own return value.
   */
  async function activateAfterVerify(
    token: string,
    localStatus: LicenseStatus,
    verifiedAt: number,
    expectedCurrentToken?: string
  ): Promise<LicenseStatus> {
    if (!isLicenseServerEnabled()) {
      cache = {
        token,
        status: localStatus,
        deviceId,
        lastVerifiedAt: verifiedAt,
        serverSync: 'disabled',
        devices: null,
        deviceLimit: null,
      };
      return localStatus;
    }

    const result: ActivateResult = await serverActivate({
      token,
      deviceId,
      deviceName: deviceMetadata.deviceName,
      os: deviceMetadata.os,
      surface: 'desktop',
    });
    if (expectedCurrentToken !== undefined && cache.token !== expectedCurrentToken) {
      return cache.status;
    }

    if (result.ok) {
      cache = {
        token,
        status: localStatus,
        deviceId,
        lastVerifiedAt: verifiedAt,
        serverSync: 'synced',
        devices: result.devices,
        deviceLimit: result.deviceLimit,
      };
      return localStatus;
    }

    if (isTransientFailure(result.reason)) {
      // 24-hour offline-grace per LICENSING_ADR Decision 4. Keep the
      // locally-verified status, the next revalidate will retry the
      // handshake and pick up the device.
      cache = {
        token,
        status: localStatus,
        deviceId,
        lastVerifiedAt: verifiedAt,
        serverSync: 'unreachable',
        devices: null,
        deviceLimit: null,
      };
      return localStatus;
    }

    const invalid =
      failureToInvalid(result.reason) ?? { kind: 'invalid' as const, reason: result.reason };
    const keepToken = result.reason === 'exhausted';
    cache = {
      token: keepToken ? token : null,
      status: invalid,
      deviceId,
      lastVerifiedAt: verifiedAt,
      serverSync: 'synced',
      devices: result.reason === 'exhausted' ? result.devices : null,
      deviceLimit: result.reason === 'exhausted' ? result.deviceLimit : null,
    };
    if (!keepToken) {
      await clearPersistedLicense(licensePath).catch(() => {
        // Best-effort — the in-memory cache already reflects the wipe.
      });
    }
    return invalid;
  }

  const persisted = await readPersistedLicense(licensePath);
  if (persisted) {
    const status = await runVerify(persisted.token, options.publicKeyJwk, now());
    if (status.kind === 'invalid') {
      // Stale or tampered token on disk — wipe so a future GetSnapshot
      // reports `free` instead of a sticky `invalid` state the user
      // cannot clear from the UI.
      await clearPersistedLicense(licensePath).catch(() => {
        // Startup should still reach the renderer even if a stale token file
        // cannot be removed. Future explicit clears keep reporting failures.
      });
      cache = freeSnapshot(now());
    } else {
      cache = {
        token: persisted.token,
        status,
        deviceId,
        lastVerifiedAt: persisted.lastVerifiedAt,
        serverSync: initialServerSync,
        devices: null,
        deviceLimit: null,
      };
    }
  }
  // Boot revalidate (when there's a rehydrated token) runs async +
  // non-blocking AFTER `runtime` is constructed below, so app.ready
  // is not delayed by a slow server roundtrip and the IIFE can call
  // back into the runtime safely.
  const shouldBootRevalidate = cache.token !== null;

  const runtime: LicenseRuntime = {
    getSnapshot: () => cache,

    applyToken: async (token: string) => {
      // Disk write happens BEFORE the cache mutation so a filesystem
      // failure (read-only userData, EACCES, EROFS) propagates as a thrown
      // error and the cache stays in sync with what's actually on disk.
      // A previous design mutated cache first; any disk failure after that
      // produced phantom-license divergence — cache says free but disk
      // still holds the old token, which would resurrect at the next boot.
      const trimmed = typeof token === 'string' ? token.trim() : '';
      if (trimmed.length === 0) {
        await clearPersistedLicense(licensePath);
        const invalid: LicenseStatus = { kind: 'invalid', reason: 'malformed' };
        cache = freeSnapshotWithStatus(invalid, now());
        return invalid;
      }
      const status = await runVerify(trimmed, options.publicKeyJwk, now());
      const verifiedAt = now();
      if (status.kind === 'invalid') {
        if (!cache.token) {
          await clearPersistedLicense(licensePath);
          cache = freeSnapshotWithStatus(status, verifiedAt);
        }
        return status;
      }
      await writePersistedLicense(licensePath, {
        token: trimmed,
        lastVerifiedAt: verifiedAt,
      });
      // Local verify succeeded; consult the license-server for the
      // per-surface bucket + device registration. Slice 3.5 wires this;
      // pre-3.5 behaviour (no server) is preserved when
      // `isLicenseServerEnabled()` is false.
      return activateAfterVerify(trimmed, status, verifiedAt);
    },

    clear: async () => {
      // Same disk-before-cache invariant as applyToken: if the unlink
      // fails the throw propagates so the IPC handler reports
      // `clear-failed` to the renderer instead of advertising free while
      // disk still holds the token.
      const previousToken = cache.token;
      await clearPersistedLicense(licensePath);
      cache = freeSnapshot(now());
      // Best-effort server-side cleanup so the desktop bucket in D1
      // does not keep a dangling row. Errors swallowed because the
      // local clear already succeeded.
      if (previousToken && isLicenseServerEnabled()) {
        void serverRemoveDevice({ token: previousToken, deviceIdToRemove: deviceId }).catch(() => {
          // The next activate from any client will idempotently
          // overwrite the row anyway.
        });
      }
    },

    revalidate: async () => {
      const currentToken = cache.token;
      if (!currentToken) {
        cache = freeSnapshot(now());
        return FREE_STATUS;
      }
      const status = await runVerify(currentToken, options.publicKeyJwk, now());
      const verifiedAt = now();
      if (cache.token !== currentToken) {
        return cache.status;
      }
      if (status.kind === 'invalid') {
        await clearPersistedLicense(licensePath);
        cache = freeSnapshotWithStatus(status, verifiedAt);
        return status;
      }
      await writePersistedLicense(licensePath, {
        token: currentToken,
        lastVerifiedAt: verifiedAt,
      });
      if (!isLicenseServerEnabled()) {
        cache = {
          token: currentToken,
          status,
          deviceId,
          lastVerifiedAt: verifiedAt,
          serverSync: 'disabled',
          devices: null,
          deviceLimit: null,
        };
        return status;
      }

      const result = await serverStatus({
        token: currentToken,
        deviceId,
        surface: 'desktop',
      });
      if (cache.token !== currentToken) {
        return cache.status;
      }

      if (!result.ok) {
        if (isTransientFailure(result.reason)) {
          cache = {
            token: currentToken,
            status,
            deviceId,
            lastVerifiedAt: verifiedAt,
            serverSync: 'unreachable',
            devices: null,
            deviceLimit: null,
          };
          return status;
        }
        const invalid =
          failureToInvalid(result.reason) ?? { kind: 'invalid' as const, reason: result.reason };
        const keepToken = result.reason === 'exhausted';
        if (!keepToken) {
          await clearPersistedLicense(licensePath).catch(() => undefined);
        }
        cache = {
          token: keepToken ? currentToken : null,
          status: invalid,
          deviceId,
          lastVerifiedAt: verifiedAt,
          serverSync: 'synced',
          devices: null,
          deviceLimit: null,
        };
        return invalid;
      }

      // Server-side license is healthy. Pick up Monthly subscription
      // `refreshedToken` only when its `issuedAt` is strictly newer
      // than the stored one (defends against a stale-replica response).
      let activeToken = currentToken;
      let activeStatus = status;
      if (typeof result.refreshedToken === 'string' && result.refreshedToken !== currentToken) {
        const oldIssuedAt = decodeIssuedAt(currentToken);
        const newIssuedAt = decodeIssuedAt(result.refreshedToken);
        if (newIssuedAt !== null && (oldIssuedAt === null || newIssuedAt > oldIssuedAt)) {
          const refreshedStatus = await runVerify(
            result.refreshedToken,
            options.publicKeyJwk,
            verifiedAt
          );
          if (cache.token !== currentToken) {
            return cache.status;
          }
          if (refreshedStatus.kind !== 'invalid') {
            activeToken = result.refreshedToken;
            activeStatus = refreshedStatus;
            await writePersistedLicense(licensePath, {
              token: activeToken,
              lastVerifiedAt: verifiedAt,
            });
          }
        }
      }

      const finalStatus = serverStatusKindToStatus(result.status, activeStatus);
      if (finalStatus.kind === 'invalid') {
        await clearPersistedLicense(licensePath).catch(() => undefined);
        cache = {
          token: null,
          status: finalStatus,
          deviceId,
          lastVerifiedAt: verifiedAt,
          serverSync: 'synced',
          devices: null,
          deviceLimit: null,
        };
        return finalStatus;
      }

      // If this device is missing from the server bucket (token
      // rehydrated from disk after a previous activate failed with
      // `exhausted`, or row was removed by another client), re-issue
      // activation so the per-surface cap is enforced. Mirror of
      // `licenseStore.ts:revalidate` deviceRegistered=false branch.
      if (!result.deviceRegistered) {
        return activateAfterVerify(activeToken, finalStatus, verifiedAt, currentToken);
      }

      cache = {
        token: activeToken,
        status: finalStatus,
        deviceId,
        lastVerifiedAt: verifiedAt,
        serverSync: 'synced',
        devices: result.devices,
        deviceLimit: result.deviceLimit,
      };
      return finalStatus;
    },

    removeDevice: async (deviceIdToRemove: string) => {
      const currentToken = cache.token;
      if (!currentToken) {
        return { ok: false, reason: 'invalid-input', message: 'No active license token.' };
      }
      if (!isLicenseServerEnabled()) {
        return { ok: false, reason: 'disabled' };
      }
      const result = await serverRemoveDevice({
        token: currentToken,
        deviceIdToRemove,
      });
      if (!result.ok) {
        if (result.reason === 'unknown-license' || result.reason === 'revoked') {
          // Terminal — wipe local state so the renderer flips to the
          // matching invalid status on next snapshot.
          const invalid = failureToInvalid(result.reason);
          if (invalid) {
            await clearPersistedLicense(licensePath).catch(() => undefined);
            cache = {
              token: null,
              status: invalid,
              deviceId,
              lastVerifiedAt: now(),
              serverSync: 'synced',
              devices: null,
              deviceLimit: null,
            };
          }
        }
        return result;
      }
      // Refresh the cached bucket from the response. If the user
      // removed the *current* device the server returns a list
      // excluding it; the next revalidate will re-activate this
      // device automatically.
      cache = {
        ...cache,
        lastVerifiedAt: now(),
        serverSync: 'synced',
        devices: result.devices,
        deviceLimit: result.deviceLimit,
      };
      return result;
    },
  };

  function freeSnapshotWithStatus(status: LicenseStatus, at: number): LicenseSnapshot {
    return {
      ...freeSnapshot(at),
      status,
    };
  }

  // Boot revalidate fires async — does not block app.ready. When it
  // resolves, the cache updates with the freshest `serverSync` /
  // `devices` / `deviceLimit` so the renderer's Devices section can
  // render under the same gate the web build already passes.
  if (shouldBootRevalidate && isLicenseServerEnabled()) {
    void runtime.revalidate().catch(() => {
      // Best-effort. Failures fall through to the existing
      // local-verify cache with `serverSync='unreachable'`.
    });
  }

  return runtime;
}

/**
 * Decode the ISO `issuedAt` from a base64url payload.signature token
 * without verifying signature. Used to compare freshness when a
 * server `refreshedToken` arrives, identical pattern to the
 * renderer's licenseStore.
 */
function decodeIssuedAt(token: string): number | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadPart = token.slice(0, dot);
  const padLen = (4 - (payloadPart.length % 4)) % 4;
  const normalised = payloadPart.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  let decoded: string;
  try {
    decoded = Buffer.from(normalised, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  let parsed: { issuedAt?: unknown };
  try {
    parsed = JSON.parse(decoded) as { issuedAt?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.issuedAt !== 'string') return null;
  const ms = Date.parse(parsed.issuedAt);
  return Number.isFinite(ms) ? ms : null;
}

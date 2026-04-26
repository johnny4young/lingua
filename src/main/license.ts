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
import { randomUUID } from 'node:crypto';
import {
  type LicenseVerificationResult,
  verifyLicenseToken,
} from '../shared/license';

export type LicenseStatus =
  | { kind: 'free' }
  | { kind: 'invalid'; reason: string; message?: string }
  | { kind: 'active'; verification: Extract<LicenseVerificationResult, { ok: true }> }
  | { kind: 'grace'; verification: Extract<LicenseVerificationResult, { ok: true }> };

export interface LicenseSnapshot {
  token: string | null;
  status: LicenseStatus;
  deviceId: string;
  lastVerifiedAt: number | null;
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
}

export interface CreateLicenseRuntimeOptions {
  userDataDir: string;
  publicKeyJwk: JsonWebKey | null;
  /** Defaults to `Date.now`. Tests inject a deterministic clock. */
  now?: () => number;
}

export async function createLicenseRuntime(
  options: CreateLicenseRuntimeOptions
): Promise<LicenseRuntime> {
  const licensePath = resolveLicensePath(options.userDataDir);
  const deviceIdPath = resolveDeviceIdPath(options.userDataDir);
  const now = options.now ?? Date.now;

  const deviceId = await loadOrCreateDeviceId(deviceIdPath);

  let cache: LicenseSnapshot = {
    token: null,
    status: FREE_STATUS,
    deviceId,
    lastVerifiedAt: null,
  };

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
      cache = {
        token: null,
        status: FREE_STATUS,
        deviceId,
        lastVerifiedAt: now(),
      };
    } else {
      cache = {
        token: persisted.token,
        status,
        deviceId,
        lastVerifiedAt: persisted.lastVerifiedAt,
      };
    }
  }

  return {
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
        cache = {
          token: null,
          status: invalid,
          deviceId,
          lastVerifiedAt: now(),
        };
        return invalid;
      }
      const status = await runVerify(trimmed, options.publicKeyJwk, now());
      const verifiedAt = now();
      if (status.kind === 'invalid') {
        if (!cache.token) {
          await clearPersistedLicense(licensePath);
          cache = {
            token: null,
            status,
            deviceId,
            lastVerifiedAt: verifiedAt,
          };
        }
        return status;
      }
      await writePersistedLicense(licensePath, {
        token: trimmed,
        lastVerifiedAt: verifiedAt,
      });
      cache = {
        token: trimmed,
        status,
        deviceId,
        lastVerifiedAt: verifiedAt,
      };
      return status;
    },

    clear: async () => {
      // Same disk-before-cache invariant as applyToken: if the unlink
      // fails the throw propagates so the IPC handler reports
      // `clear-failed` to the renderer instead of advertising free while
      // disk still holds the token.
      await clearPersistedLicense(licensePath);
      cache = {
        token: null,
        status: FREE_STATUS,
        deviceId,
        lastVerifiedAt: now(),
      };
    },

    revalidate: async () => {
      const currentToken = cache.token;
      if (!currentToken) {
        cache = {
          ...cache,
          status: FREE_STATUS,
          lastVerifiedAt: now(),
        };
        return FREE_STATUS;
      }
      const status = await runVerify(currentToken, options.publicKeyJwk, now());
      const verifiedAt = now();
      if (status.kind === 'invalid') {
        await clearPersistedLicense(licensePath);
        cache = {
          token: null,
          status,
          deviceId,
          lastVerifiedAt: verifiedAt,
        };
        return status;
      }
      await writePersistedLicense(licensePath, {
        token: currentToken,
        lastVerifiedAt: verifiedAt,
      });
      cache = {
        ...cache,
        token: currentToken,
        status,
        lastVerifiedAt: verifiedAt,
      };
      return status;
    },
  };
}

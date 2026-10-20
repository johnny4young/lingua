/**
 * Encrypted secret store on Electron `safeStorage`.
 *
 * One file per id under `userData/secrets`, written atomically with mode 0600.
 * When the OS offers no real keyring (encryption unavailable, or Linux reports
 * the `basic_text` backend) values are kept in memory for the session and
 * never written to disk.
 */

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isValidSecretId,
  isValidSecretPrefix,
  isValidSecretValue,
  type SecretStorageMode,
  type SecretVaultStatus,
  type SecretWriteResult,
} from '../shared/secretVault';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

export interface SecretStore {
  status(): SecretVaultStatus;
  set(id: string, value: string): Promise<SecretWriteResult>;
  get(id: string): Promise<string | null>;
  delete(id: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

const FILE_SUFFIX = '.secret';
const TMP_SUFFIX = '.tmp';
/** Linux backends that encrypt with a real keyring; anything else stays in memory. */
const LINUX_KEYRINGS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

export function resolveSecretsDir(userDataDir: string): string {
  return path.join(userDataDir, 'secrets');
}

export function createSecretStore(options: {
  readonly dir: string;
  readonly safeStorage: SafeStorageLike;
  readonly platform?: NodeJS.Platform;
}): SecretStore {
  const { dir, safeStorage } = options;
  const platform = options.platform ?? process.platform;
  const session = new Map<string, string>();

  const backend =
    platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : undefined;
  const keyring = platform !== 'linux' || (backend !== undefined && LINUX_KEYRINGS.has(backend));
  const mode: SecretStorageMode =
    safeStorage.isEncryptionAvailable() && keyring ? 'encrypted' : 'session';

  const fileFor = (id: string) => path.join(dir, `${id}${FILE_SUFFIX}`);

  // Temp files left by a crash mid-write; writes wait for this so it never sees theirs.
  const sweep = readdir(dir)
    .then((names) =>
      Promise.all(
        names.filter((name) => name.endsWith(TMP_SUFFIX)).map((name) => rm(path.join(dir, name), { force: true }))
      )
    )
    .catch(() => undefined);

  return {
    status: () => (backend ? { mode, backend } : { mode }),

    async set(id, value) {
      if (!isValidSecretId(id)) return { ok: false, reason: 'invalid-id' };
      if (!isValidSecretValue(value)) return { ok: false, reason: 'invalid-value' };
      if (mode === 'session') {
        session.set(id, value);
        return { ok: true, mode };
      }
      await sweep;
      const target = fileFor(id);
      const tmp = `${target}.${randomUUID()}${TMP_SUFFIX}`;
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(tmp, safeStorage.encryptString(value), { mode: 0o600 });
        if (platform !== 'win32') await chmod(tmp, 0o600);
        await rename(tmp, target);
        return { ok: true, mode };
      } catch {
        await rm(tmp, { force: true }).catch(() => undefined);
        return { ok: false, reason: 'write-failed' };
      }
    },

    async get(id) {
      if (!isValidSecretId(id)) return null;
      if (mode === 'session') return session.get(id) ?? null;
      try {
        return safeStorage.decryptString(await readFile(fileFor(id)));
      } catch {
        return null;
      }
    },

    async delete(id) {
      if (!isValidSecretId(id)) return false;
      session.delete(id);
      try {
        await rm(fileFor(id), { force: true });
        return true;
      } catch {
        return false;
      }
    },

    async list(prefix) {
      if (!isValidSecretPrefix(prefix)) return [];
      const ids = new Set([...session.keys()].filter((id) => id.startsWith(prefix)));
      // Files from an earlier keyring session are listed too, so a reset can delete them.
      try {
        for (const name of await readdir(dir)) {
          if (!name.endsWith(FILE_SUFFIX)) continue;
          const id = name.slice(0, -FILE_SUFFIX.length);
          if (id.startsWith(prefix) && isValidSecretId(id)) ids.add(id);
        }
      } catch {
        // No secrets written yet.
      }
      return [...ids].sort();
    },
  };
}

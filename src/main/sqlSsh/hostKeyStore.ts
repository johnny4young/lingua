/**
 * SSH host keys trusted in Lingua, one JSON file under userData written
 * atomically with mode 0600. ~/.ssh/known_hosts is read, never written.
 */

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { knownHostToken, type KnownHostKey } from './knownHosts';

export function resolveHostKeyStorePath(userDataDir: string): string {
  return path.join(userDataDir, 'sql-ssh-host-keys.json');
}

const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const TYPE_RE = /^[a-z0-9@.-]{3,64}$/;

export function createHostKeyStore(filePath: string) {
  let cache: Map<string, KnownHostKey[]> | null = null;
  let writing: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Map<string, KnownHostKey[]>> {
    if (cache) return cache;
    // A Map, so a host named constructor or __proto__ is just another key.
    const keys = new Map<string, KnownHostKey[]>();
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf-8')) as { keys?: Record<string, unknown> };
      for (const [token, list] of Object.entries(raw.keys ?? {})) {
        if (!Array.isArray(list)) continue;
        const valid = list.filter(
          (entry): entry is KnownHostKey =>
            typeof entry?.type === 'string' && TYPE_RE.test(entry.type) && typeof entry.fingerprint === 'string' && FINGERPRINT_RE.test(entry.fingerprint)
        );
        if (valid.length > 0) keys.set(token, valid.map(({ type, fingerprint }) => ({ type, fingerprint })));
      }
    } catch {
      // A missing or broken file trusts nothing.
    }
    cache = keys;
    return keys;
  }

  async function persist(next: Map<string, KnownHostKey[]>): Promise<void> {
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tmp, `${JSON.stringify({ version: 1, keys: Object.fromEntries(next) }, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(tmp, 0o600);
    try {
      await rename(tmp, filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    cache = next;
  }

  return {
    async list(host: string, port: number): Promise<KnownHostKey[]> {
      return (await load()).get(knownHostToken(host, port)) ?? [];
    },

    /** Trusts a key for the host, in place of any key of the same type. Main only calls it for a key no one knew. */
    trust(host: string, port: number, key: KnownHostKey): Promise<boolean> {
      if (!TYPE_RE.test(key.type) || !FINGERPRINT_RE.test(key.fingerprint)) return Promise.resolve(false);
      const run = async () => {
        const current = await load();
        const token = knownHostToken(host, port);
        const list = (current.get(token) ?? []).filter((entry) => entry.type !== key.type);
        await persist(new Map([...current, [token, [...list, { type: key.type, fingerprint: key.fingerprint }]]]));
        return true;
      };
      const next = writing.then(run, run);
      writing = next.catch(() => undefined);
      return next;
    },
  };
}

export type HostKeyStore = ReturnType<typeof createHostKeyStore>;

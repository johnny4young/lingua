/**
 * The saved database connections, in one JSON file under userData written
 * atomically with mode 0600. It never holds a password; those live in the
 * secret store under `db.<id>`.
 */

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseConnection, type SqlConnectionDraft, type SqlConnectionV1 } from '../shared/sqlConnections';

export function resolveConnectionCatalogPath(userDataDir: string): string {
  return path.join(userDataDir, 'sql-connections.json');
}

export function createConnectionCatalog(filePath: string, now: () => Date = () => new Date()) {
  let cache: SqlConnectionV1[] | null = null;
  // Writes go one after another so two saves cannot lose each other.
  let writing: Promise<unknown> = Promise.resolve();

  async function load(): Promise<SqlConnectionV1[]> {
    if (cache) return cache;
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf-8')) as { connections?: unknown };
      const list = Array.isArray(raw.connections) ? raw.connections : [];
      cache = list.map(parseConnection).filter((entry): entry is SqlConnectionV1 => entry !== null);
    } catch {
      cache = [];
    }
    return cache;
  }

  async function persist(next: SqlConnectionV1[]): Promise<void> {
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tmp, `${JSON.stringify({ version: 1, connections: next }, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(tmp, 0o600);
    try {
      await rename(tmp, filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    cache = next;
  }

  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writing.then(work, work);
    writing = next.catch(() => undefined);
    return next;
  };

  return {
    list: load,

    async get(id: string): Promise<SqlConnectionV1 | null> {
      return (await load()).find((entry) => entry.id === id) ?? null;
    },

    /** Creates when `id` is absent; null for an unknown id, `quota` when a new one would pass `limit`. */
    save(draft: SqlConnectionDraft, id?: string, limit?: number): Promise<SqlConnectionV1 | null | 'quota'> {
      return serialized(async () => {
        const list = await load();
        const stamp = now().toISOString();
        if (id === undefined) {
          if (limit !== undefined && list.length >= limit) return 'quota';
          const created: SqlConnectionV1 = { version: 1, id: `c_${randomUUID().replaceAll('-', '')}`, ...draft, createdAt: stamp, updatedAt: stamp };
          await persist([...list, created]);
          return created;
        }
        const existing = list.find((entry) => entry.id === id);
        if (!existing) return null;
        const updated: SqlConnectionV1 = { version: 1, id, ...draft, createdAt: existing.createdAt, updatedAt: stamp };
        await persist(list.map((entry) => (entry.id === id ? updated : entry)));
        return updated;
      });
    },

    remove(id: string): Promise<boolean> {
      return serialized(async () => {
        const list = await load();
        if (!list.some((entry) => entry.id === id)) return false;
        await persist(list.filter((entry) => entry.id !== id));
        return true;
      });
    },
  };
}

export type ConnectionCatalog = ReturnType<typeof createConnectionCatalog>;

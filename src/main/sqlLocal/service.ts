/**
 * Main's side of the native Local SQL engine. Main decides every path, stamps
 * each request with the renderer that sent it and starts one utilityProcess per
 * renderer on its first request, so a forced restart or a crash ends only that
 * window's engine. Main also decides which window gets the database file. A
 * build without the DuckDB binding answers `unavailable` and the renderer keeps
 * DuckDB-WASM.
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { SqlLocalError, SqlLocalOpened, SqlLocalQueryResult, SqlLocalReply, SqlLocalStatus, SqlLocalStreamOpened } from '../../shared/sqlLocal';
import { SqlHostError, type SqlHostRequestBody, type SqlHostSupervisor } from '../sqlHostSupervisor';
import { sizeOf } from './fileSize';
import { withoutFolder } from './messages';
import type { LocalPaths, LocalRequest } from './protocol';

type SqlLocalHost = SqlHostSupervisor<LocalRequest, SqlLocalError>;

/** Whether this build ships the binding for this platform; resolving reads no native code. */
export function nativeSqlEngineAvailable(resolve: (id: string) => string = createRequire(__filename).resolve): boolean {
  try {
    resolve('@duckdb/node-api');
    resolve(`@duckdb/node-bindings-${process.platform}-${process.arch}/package.json`);
    return true;
  } catch {
    return false;
  }
}

export interface SqlLocalServiceDeps {
  /** A supervisor for one window's process; it forks nothing until its first request. */
  createHost: () => SqlLocalHost;
  /** Lingua's folder for the engine, inside the app's user data. */
  root: string;
  available: () => boolean;
}

const home = homedir();

/** How long a window's process may take to close its engines before main stops it. */
const DISPOSE_TIMEOUT_MS = 3_000;

const unavailable: SqlLocalReply<never> = {
  ok: false,
  error: { message: 'This build does not include the native SQL engine.', code: 'unavailable' },
};

export function createSqlLocalService(deps: SqlLocalServiceDeps) {
  const database = path.join(deps.root, 'lingua-sql.duckdb');
  let version: string | undefined;
  /** Which window opened each engine, so a forced restart answers only to that window. */
  const owners = new Map<string, number>();
  const hosts = new Map<number, SqlLocalHost>();
  /** A released window's process still stopping; that window's next process waits for it. */
  const stopping = new Map<number, Promise<void>>();
  /** The window whose engine holds the database file; one at a time, as a second WASM tab. */
  let persistentOwner: number | null = null;
  /** Set while that window's open is in flight, before its process runs. */
  let claiming: number | null = null;

  const filesOf = (owner: number) => path.join(deps.root, 'files', String(owner));
  const tempOf = (owner: number) => path.join(deps.root, 'tmp', String(owner));
  const pathsFor = (owner: number): LocalPaths => ({ database, files: filesOf(owner), temp: tempOf(owner) });

  const sweep = (folders: string[]) => Promise.all(folders.map(folder => rm(folder, { recursive: true, force: true }))).then(() => undefined);
  // No process is alive yet: every window's leftover files and spill go.
  const swept = sweep([path.join(deps.root, 'files'), path.join(deps.root, 'tmp')]).catch(() => undefined);

  const holder = () =>
    persistentOwner !== null && (claiming === persistentOwner || hosts.get(persistentOwner)?.isRunning()) ? persistentOwner : null;

  function hostFor(owner: number): SqlLocalHost {
    let host = hosts.get(owner);
    if (!host) {
      host = deps.createHost();
      hosts.set(owner, host);
    }
    return host;
  }

  async function call<T>(owner: number, body: SqlHostRequestBody<LocalRequest>): Promise<SqlLocalReply<T>> {
    if (!deps.available()) return unavailable;
    try {
      await swept;
      await stopping.get(owner);
      return { ok: true, value: await hostFor(owner).request<T>(body) };
    } catch (error) {
      const detail: SqlLocalError = error instanceof SqlHostError ? (error.detail as SqlLocalError) : { message: String(error) };
      return { ok: false, error: { ...detail, message: home ? withoutFolder(detail.message, home, '~') : detail.message } };
    }
  }

  /** Lets the process close its engines (checkpointing the file), then stops it and removes the window's folders. */
  async function shutdown(owner: number, host: SqlLocalHost): Promise<void> {
    if (host.isRunning()) await host.request({ type: 'dispose' }, DISPOSE_TIMEOUT_MS).catch(() => undefined);
    await host.dispose();
    await sweep([filesOf(owner), tempOf(owner)]).catch(() => undefined);
  }

  function forget(owner: number): void {
    for (const [engineId, holder] of owners) if (holder === owner) owners.delete(engineId);
    if (persistentOwner === owner) persistentOwner = null;
    if (claiming === owner) claiming = null;
  }

  function release(owner: number): Promise<void> {
    forget(owner);
    const host = hosts.get(owner);
    if (!host) return stopping.get(owner) ?? Promise.resolve();
    hosts.delete(owner);
    const done = (stopping.get(owner) ?? Promise.resolve()).then(() => shutdown(owner, host));
    stopping.set(owner, done);
    void done.finally(() => {
      if (stopping.get(owner) === done) stopping.delete(owner);
    });
    return done;
  }

  return {
    status: (): SqlLocalStatus => ({ available: deps.available(), ...(version ? { version } : {}) }),

    async open(owner: number, persist: boolean): Promise<SqlLocalReply<SqlLocalOpened>> {
      forget(owner);
      // Claimed before the await, so two windows opening at once never both ask for the file.
      const claims = persist && holder() === null;
      if (claims) persistentOwner = claiming = owner;
      const reply = await call<SqlLocalOpened>(owner, { type: 'open', owner, persist: claims, paths: pathsFor(owner) });
      if (claims && claiming === owner) claiming = null;
      if (claims && persistentOwner === owner && !(reply.ok && reply.value.storageMode === 'opfs')) persistentOwner = null;
      if (reply.ok) {
        version = reply.value.version;
        owners.set(reply.value.engineId, owner);
      }
      return reply;
    },
    connect: (owner: number, engineId: string) => call<string>(owner, { type: 'connect', owner, engineId }),
    query: (owner: number, connectionId: string, sql: string) => call<SqlLocalQueryResult>(owner, { type: 'query', owner, connectionId, sql }),
    stream: (owner: number, connectionId: string, sql: string) => call<SqlLocalStreamOpened>(owner, { type: 'stream', owner, connectionId, sql }),
    next: (owner: number, streamId: string) => call<Array<Record<string, unknown>> | null>(owner, { type: 'next', owner, streamId }),
    cancel: (owner: number, connectionId: string) => call<boolean>(owner, { type: 'cancel', owner, connectionId }),
    closeConnection: (owner: number, connectionId: string) => call<null>(owner, { type: 'close-connection', owner, connectionId }),
    registerFile: (owner: number, engineId: string, name: string, bytes: Uint8Array) => call<null>(owner, { type: 'register-file', owner, engineId, name, bytes }),
    registerEmptyFile: (owner: number, engineId: string, name: string) => call<null>(owner, { type: 'register-empty-file', owner, engineId, name }),
    dropFile: (owner: number, engineId: string, name: string) => call<null>(owner, { type: 'drop-file', owner, engineId, name }),
    readFile: (owner: number, engineId: string, name: string) => call<Uint8Array>(owner, { type: 'read-file', owner, engineId, name }),

    async terminate(owner: number, engineId: string, force: boolean): Promise<SqlLocalReply<null>> {
      if (owners.get(engineId) !== owner) return { ok: true, value: null };
      owners.delete(engineId);
      if (persistentOwner === owner) persistentOwner = null;
      const host = hosts.get(owner);
      if (!host?.isRunning()) return { ok: true, value: null };
      // A statement that ignored Cancel holds a DuckDB thread; only a new process frees it.
      if (force) {
        host.restart();
        return { ok: true, value: null };
      }
      return call<null>(owner, { type: 'terminate', owner, engineId });
    },

    /** The renderer reloaded, navigated or closed: its process, engine and files go with it. */
    releaseOwner(owner: number): void {
      void release(owner);
    },

    async clearDatabase(): Promise<SqlLocalReply<null>> {
      // The process holding the file answers, refusing while its engine is open.
      const owner = holder();
      if (owner !== null) return call<null>(owner, { type: 'clear-database', database });
      try {
        await Promise.all([rm(database, { force: true }), rm(`${database}.wal`, { force: true })]);
        return { ok: true, value: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: { message: home ? withoutFolder(message, home, '~') : message } };
      }
    },

    async databaseBytes(): Promise<SqlLocalReply<number | null>> {
      try {
        return { ok: true, value: (await sizeOf(database)) + (await sizeOf(`${database}.wal`)) };
      } catch {
        return { ok: true, value: null };
      }
    },

    async dispose(): Promise<void> {
      await Promise.all([...hosts.keys()].map(release));
    },
  };
}

export type SqlLocalService = ReturnType<typeof createSqlLocalService>;

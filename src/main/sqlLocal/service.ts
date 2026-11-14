/**
 * Main's side of the native Local SQL engine. Main decides every path, stamps
 * each request with the renderer that sent it and starts one utilityProcess per
 * renderer on its first request, so a forced restart or a crash ends only that
 * window's engine. Main also decides which window gets the database file. A
 * build without the DuckDB binding answers `unavailable` and the renderer keeps
 * DuckDB-WASM.
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { SqlLocalError, SqlLocalOpened, SqlLocalQueryResult, SqlLocalReply, SqlLocalStatus, SqlLocalStreamOpened } from '../../shared/sqlLocal';
import type { Host } from '@electron-stagewright/host-supervisor';
import { settle, SqlHostError } from '../sqlHostClient';
import { sizeOf } from './fileSize';
import { withoutFolder } from './messages';
import { ENGINE_GONE_MESSAGE, RESULT_CLOSED_MESSAGE, type LocalPaths, type LocalReply, type LocalStreamItem, type SqlLocalOps } from './protocol';

type SqlLocalHost = Pick<Host<SqlLocalOps>, 'call' | 'stream' | 'kill' | 'close' | 'state'>;

interface OpenStream {
  owner: number;
  connectionId: string;
  items: AsyncIterator<LocalStreamItem>;
}

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
  /** One window's process; it forks nothing until its first call. */
  createHost: () => SqlLocalHost;
  /** Lingua's folder for the engine, inside the app's user data. */
  root: string;
  available: () => boolean;
}

const home = homedir();

/** How long a window's process may take to close its engines before main stops it. */
const DISPOSE_TIMEOUT_MS = 3_000;

const engineGone = (message?: string): SqlLocalError => ({ message: message ?? ENGINE_GONE_MESSAGE, code: 'engine-gone' });
const isRunning = (host: SqlLocalHost | undefined) => host?.state === 'running' || host?.state === 'starting';

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
  /** Results main hands out by id; each one pulls its host stream one batch at a time. */
  const streams = new Map<string, OpenStream>();
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
    persistentOwner !== null && (claiming === persistentOwner || isRunning(hosts.get(persistentOwner))) ? persistentOwner : null;

  function hostFor(owner: number): SqlLocalHost {
    let host = hosts.get(owner);
    if (!host) {
      host = deps.createHost();
      hosts.set(owner, host);
    }
    return host;
  }

  const failure = (error: unknown): SqlLocalReply<never> => {
    const detail: SqlLocalError = error instanceof SqlHostError ? (error.detail as SqlLocalError) : { message: String(error) };
    return { ok: false, error: { ...detail, message: home ? withoutFolder(detail.message, home, '~') : detail.message } };
  };

  async function call<T>(owner: number, ask: (host: SqlLocalHost) => Promise<LocalReply<T>>): Promise<SqlLocalReply<T>> {
    if (!deps.available()) return unavailable;
    try {
      await swept;
      await stopping.get(owner);
      return { ok: true, value: await settle(ask(hostFor(owner)), () => engineGone()) };
    } catch (error) {
      return failure(error);
    }
  }

  /** Lets go of a result early, so the engine stops holding it. */
  function closeStream(streamId: string): void {
    const open = streams.get(streamId);
    if (!open) return;
    streams.delete(streamId);
    void open.items.return?.().catch(() => undefined);
  }

  function closeStreamsOf(owner: number, connectionId?: string): void {
    for (const [streamId, open] of streams) {
      if (open.owner === owner && (connectionId === undefined || open.connectionId === connectionId)) closeStream(streamId);
    }
  }

  /** Lets the process close its engines (checkpointing the file), then stops it and removes the window's folders. */
  async function shutdown(owner: number, host: SqlLocalHost): Promise<void> {
    if (isRunning(host)) await host.call('dispose', [], { timeoutMs: DISPOSE_TIMEOUT_MS }).catch(() => undefined);
    await host.close().catch(() => undefined);
    await sweep([filesOf(owner), tempOf(owner)]).catch(() => undefined);
  }

  function forget(owner: number): void {
    closeStreamsOf(owner);
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
      const reply = await call<SqlLocalOpened>(owner, host => host.call('open', [owner, claims, pathsFor(owner)]));
      if (claims && claiming === owner) claiming = null;
      if (claims && persistentOwner === owner && !(reply.ok && reply.value.storageMode === 'opfs')) persistentOwner = null;
      if (reply.ok) {
        version = reply.value.version;
        owners.set(reply.value.engineId, owner);
      }
      return reply;
    },
    connect: (owner: number, engineId: string) => call<string>(owner, host => host.call('connect', [owner, engineId])),
    query(owner: number, connectionId: string, sql: string): Promise<SqlLocalReply<SqlLocalQueryResult>> {
      // A new statement ends the connection's open result, as it does in DuckDB.
      closeStreamsOf(owner, connectionId);
      return call(owner, host => host.call('query', [owner, connectionId, sql]));
    },

    async stream(owner: number, connectionId: string, sql: string): Promise<SqlLocalReply<SqlLocalStreamOpened>> {
      closeStreamsOf(owner, connectionId);
      if (!deps.available()) return unavailable;
      try {
        await swept;
        await stopping.get(owner);
        const items = hostFor(owner).stream('rows', [owner, connectionId, sql])[Symbol.asyncIterator]();
        const first = await items.next();
        if (first.done) return { ok: false, error: { message: RESULT_CLOSED_MESSAGE } };
        if (!first.value.ok) return failure(new SqlHostError(first.value.error));
        if (!('columns' in first.value)) throw new Error('The SQL engine sent rows before columns.');
        const streamId = randomUUID();
        streams.set(streamId, { owner, connectionId, items });
        return { ok: true, value: { streamId, columns: first.value.columns } };
      } catch {
        return failure(new SqlHostError(engineGone()));
      }
    },

    async next(owner: number, streamId: string): Promise<SqlLocalReply<Array<Record<string, unknown>> | null>> {
      const open = streams.get(streamId);
      if (!open || open.owner !== owner) {
        return { ok: false, error: isRunning(hosts.get(owner)) ? { message: RESULT_CLOSED_MESSAGE } : engineGone() };
      }
      try {
        const item = await open.items.next();
        if (item.done) {
          streams.delete(streamId);
          return { ok: true, value: null };
        }
        if (!item.value.ok) {
          streams.delete(streamId);
          return failure(new SqlHostError(item.value.error));
        }
        return { ok: true, value: 'rows' in item.value ? item.value.rows : [] };
      } catch {
        streams.delete(streamId);
        return failure(new SqlHostError(engineGone()));
      }
    },

    cancel: (owner: number, connectionId: string) => call<boolean>(owner, host => host.call('cancel', [owner, connectionId])),
    closeConnection(owner: number, connectionId: string): Promise<SqlLocalReply<null>> {
      closeStreamsOf(owner, connectionId);
      return call(owner, host => host.call('closeConnection', [owner, connectionId]));
    },
    registerFile: (owner: number, engineId: string, name: string, bytes: Uint8Array) =>
      call<null>(owner, host => host.call('registerFile', [owner, engineId, name, bytes])),
    registerEmptyFile: (owner: number, engineId: string, name: string) => call<null>(owner, host => host.call('registerEmptyFile', [owner, engineId, name])),
    dropFile: (owner: number, engineId: string, name: string) => call<null>(owner, host => host.call('dropFile', [owner, engineId, name])),
    readFile: (owner: number, engineId: string, name: string) => call<Uint8Array>(owner, host => host.call('readFile', [owner, engineId, name])),

    async terminate(owner: number, engineId: string, force: boolean): Promise<SqlLocalReply<null>> {
      if (owners.get(engineId) !== owner) return { ok: true, value: null };
      owners.delete(engineId);
      if (persistentOwner === owner) persistentOwner = null;
      const host = hosts.get(owner);
      if (!host || !isRunning(host)) return { ok: true, value: null };
      // A statement that ignored Cancel holds a DuckDB thread; only a new process frees it.
      if (force) {
        closeStreamsOf(owner);
        void host.kill();
        return { ok: true, value: null };
      }
      return call<null>(owner, host => host.call('terminate', [owner, engineId]));
    },

    /** The renderer reloaded, navigated or closed: its process, engine and files go with it. */
    releaseOwner(owner: number): void {
      void release(owner);
    },

    async clearDatabase(): Promise<SqlLocalReply<null>> {
      // The process holding the file answers, refusing while its engine is open.
      const owner = holder();
      if (owner !== null) return call<null>(owner, host => host.call('clearDatabase', [database]));
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

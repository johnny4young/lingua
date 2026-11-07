/**
 * Main's side of the native Local SQL engine. Main decides every path, stamps
 * each request with the renderer that sent it and starts the utilityProcess on
 * first use; a build without the DuckDB binding answers `unavailable` and the
 * renderer keeps DuckDB-WASM.
 */

import { createRequire } from 'node:module';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SqlLocalError, SqlLocalOpened, SqlLocalQueryResult, SqlLocalReply, SqlLocalStatus, SqlLocalStreamOpened } from '../../shared/sqlLocal';
import { SqlHostError, type SqlHostSupervisor } from '../sqlHostSupervisor';
import type { LocalPaths, LocalRequest } from './protocol';

type SqlLocalHost = SqlHostSupervisor<LocalRequest, SqlLocalError>;
type Body = LocalRequest extends infer R ? (R extends LocalRequest ? Omit<R, 'id'> : never) : never;

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
  host: SqlLocalHost;
  /** Lingua's folder for the engine, inside the app's user data. */
  root: string;
  available: () => boolean;
}

const unavailable: SqlLocalReply<never> = {
  ok: false,
  error: { message: 'This build does not include the native SQL engine.', code: 'unavailable' },
};

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export function createSqlLocalService(deps: SqlLocalServiceDeps) {
  const database = path.join(deps.root, 'lingua-sql.duckdb');
  let version: string | undefined;

  const pathsFor = (owner: number): LocalPaths => ({
    database,
    files: path.join(deps.root, 'files', String(owner)),
    temp: path.join(deps.root, 'tmp', String(owner)),
  });

  async function call<T>(body: Body): Promise<SqlLocalReply<T>> {
    if (!deps.available()) return unavailable;
    try {
      return { ok: true, value: await deps.host.request<T>(body) };
    } catch (error) {
      return { ok: false, error: error instanceof SqlHostError ? (error.detail as SqlLocalError) : { message: String(error) } };
    }
  }

  return {
    status: (): SqlLocalStatus => ({ available: deps.available(), ...(version ? { version } : {}) }),

    async open(owner: number, persist: boolean): Promise<SqlLocalReply<SqlLocalOpened>> {
      const reply = await call<SqlLocalOpened>({ type: 'open', owner, persist, paths: pathsFor(owner) });
      if (reply.ok) version = reply.value.version;
      return reply;
    },
    connect: (owner: number, engineId: string) => call<string>({ type: 'connect', owner, engineId }),
    query: (owner: number, connectionId: string, sql: string) => call<SqlLocalQueryResult>({ type: 'query', owner, connectionId, sql }),
    stream: (owner: number, connectionId: string, sql: string) => call<SqlLocalStreamOpened>({ type: 'stream', owner, connectionId, sql }),
    next: (owner: number, streamId: string) => call<Array<Record<string, unknown>> | null>({ type: 'next', owner, streamId }),
    cancel: (owner: number, connectionId: string) => call<boolean>({ type: 'cancel', owner, connectionId }),
    closeConnection: (owner: number, connectionId: string) => call<null>({ type: 'close-connection', owner, connectionId }),
    registerFile: (owner: number, engineId: string, name: string, bytes: Uint8Array) => call<null>({ type: 'register-file', owner, engineId, name, bytes }),
    registerEmptyFile: (owner: number, engineId: string, name: string) => call<null>({ type: 'register-empty-file', owner, engineId, name }),
    dropFile: (owner: number, engineId: string, name: string) => call<null>({ type: 'drop-file', owner, engineId, name }),
    readFile: (owner: number, engineId: string, name: string) => call<Uint8Array>({ type: 'read-file', owner, engineId, name }),

    async terminate(owner: number, engineId: string, force: boolean): Promise<SqlLocalReply<null>> {
      // A statement that ignored Cancel holds a DuckDB thread; only a new process frees it.
      if (force) {
        deps.host.restart();
        return { ok: true, value: null };
      }
      return deps.host.isRunning() ? call<null>({ type: 'terminate', owner, engineId }) : { ok: true, value: null };
    },

    /** The renderer reloaded, navigated or closed: its engine and files go with it. */
    releaseOwner(owner: number): void {
      if (deps.host.isRunning()) void call<null>({ type: 'release-owner', owner });
    },

    async clearDatabase(): Promise<SqlLocalReply<null>> {
      if (deps.host.isRunning()) return call<null>({ type: 'clear-database', database });
      await Promise.all([rm(database, { force: true }), rm(`${database}.wal`, { force: true })]);
      return { ok: true, value: null };
    },

    async databaseBytes(): Promise<SqlLocalReply<number | null>> {
      try {
        return { ok: true, value: (await sizeOf(database)) + (await sizeOf(`${database}.wal`)) };
      } catch {
        return { ok: true, value: null };
      }
    },

    dispose(): void {
      deps.host.dispose();
    },
  };
}

export type SqlLocalService = ReturnType<typeof createSqlLocalService>;

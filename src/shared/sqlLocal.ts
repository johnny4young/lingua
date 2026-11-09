/**
 * The desktop's native Local SQL engine: DuckDB through `@duckdb/node-api` in
 * its own utilityProcess. The renderer reaches it through `window.lingua.sqlLocal`;
 * web builds have no bridge and keep DuckDB-WASM.
 */

import type { SqlColumnMetadata, SqlStorageMode } from './sqlWorkspace';

/** Which engine runs Local SQL; `native` falls back to WASM when it cannot start. */
export type SqlLocalEnginePreference = 'native' | 'wasm';

export interface SqlLocalStatus {
  available: boolean;
  /** DuckDB's version once the engine has started, e.g. `v1.4.3`. */
  version?: string;
}

export interface SqlLocalOpened {
  engineId: string;
  storageMode: SqlStorageMode;
  version: string;
  /** Where registered files live; SQL names them by absolute path, the only kind DuckDB lets it read. */
  filesDir: string;
}

export interface SqlLocalQueryResult {
  columns: SqlColumnMetadata[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  tooLarge: boolean;
}

export interface SqlLocalStreamOpened {
  streamId: string;
  columns: SqlColumnMetadata[];
}

/** `engine-gone` means the engine or its process ended; the next run starts a new one. */
export type SqlLocalErrorCode = 'engine-gone' | 'unavailable';

export interface SqlLocalError {
  message: string;
  code?: SqlLocalErrorCode;
}

/** Every bridge call settles to this, so DuckDB's message reaches the grid without Electron's IPC prefix. */
export type SqlLocalReply<T> = { ok: true; value: T } | { ok: false; error: SqlLocalError };

export interface SqlLocalBridge {
  status: () => Promise<SqlLocalStatus>;
  open: (persist: boolean) => Promise<SqlLocalReply<SqlLocalOpened>>;
  connect: (engineId: string) => Promise<SqlLocalReply<string>>;
  query: (connectionId: string, sql: string) => Promise<SqlLocalReply<SqlLocalQueryResult>>;
  stream: (connectionId: string, sql: string) => Promise<SqlLocalReply<SqlLocalStreamOpened>>;
  /** The next batch of a stream, null once DuckDB has no more rows. */
  next: (streamId: string) => Promise<SqlLocalReply<Array<Record<string, unknown>> | null>>;
  cancel: (connectionId: string) => Promise<SqlLocalReply<boolean>>;
  closeConnection: (connectionId: string) => Promise<SqlLocalReply<null>>;
  registerFile: (engineId: string, name: string, bytes: Uint8Array) => Promise<SqlLocalReply<null>>;
  registerEmptyFile: (engineId: string, name: string) => Promise<SqlLocalReply<null>>;
  dropFile: (engineId: string, name: string) => Promise<SqlLocalReply<null>>;
  readFile: (engineId: string, name: string) => Promise<SqlLocalReply<Uint8Array>>;
  /** `force` restarts the engine's process, for a statement that ignored Cancel. */
  terminate: (engineId: string, force: boolean) => Promise<SqlLocalReply<null>>;
  clearDatabase: () => Promise<SqlLocalReply<null>>;
  databaseBytes: () => Promise<SqlLocalReply<number | null>>;
}

/** Names the client generates for import and export files; nothing else is a file name. */
const SQL_LOCAL_FILE_NAME = /^lingua_(?:import|export)_[A-Za-z0-9-]{1,64}\.(?:csv|tsv|json|ndjson|parquet|md|sql|xlsx)$/;

export const isSqlLocalFileName = (value: unknown): value is string =>
  typeof value === 'string' && SQL_LOCAL_FILE_NAME.test(value);

/** Ids main and the engine hand out. */
export const isSqlLocalId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

/** One registered file; import and Copy to Local stay well under it. */
export const SQL_LOCAL_MAX_FILE_BYTES = 256 * 1024 * 1024;
/** A file DuckDB wrote for an export; more than this stays a WASM-sized failure instead of a main-process spike. */
export const SQL_LOCAL_MAX_READ_BYTES = 1024 * 1024 * 1024;
export const SQL_LOCAL_MAX_CONNECTIONS = 64;
export const SQL_LOCAL_MAX_STREAMS = 64;

/**
 * Messages between main and the Local SQL utilityProcess. Main stamps every
 * request with the renderer that sent it and owns every path; the process only
 * serves an id to the owner it was opened for.
 */

import type { SqlLocalOpened, SqlLocalQueryResult } from '../../shared/sqlLocal';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';

export interface LocalPaths {
  /** The persisted database file, shared by every owner but held by one engine at a time. */
  database: string;
  /** This owner's registered files: the one folder SQL may read and write. */
  files: string;
  /** Where DuckDB spills when a query outgrows memory; SQL cannot name it. */
  temp: string;
}

/** One operation as data, as the engine's handler and its tests take it. */
export type LocalRequest =
  | { type: 'open'; owner: number; persist: boolean; paths: LocalPaths }
  | { type: 'connect'; owner: number; engineId: string }
  | { type: 'query'; owner: number; connectionId: string; sql: string }
  | { type: 'stream'; owner: number; connectionId: string; sql: string }
  | { type: 'next'; owner: number; streamId: string }
  | { type: 'close-stream'; owner: number; streamId: string }
  | { type: 'cancel'; owner: number; connectionId: string }
  | { type: 'close-connection'; owner: number; connectionId: string }
  | { type: 'register-file'; owner: number; engineId: string; name: string; bytes: Uint8Array }
  | { type: 'register-empty-file'; owner: number; engineId: string; name: string }
  | { type: 'drop-file'; owner: number; engineId: string; name: string }
  | { type: 'read-file'; owner: number; engineId: string; name: string }
  | { type: 'terminate'; owner: number; engineId: string }
  | { type: 'release-owner'; owner: number }
  /** Closes every engine, so the persisted file is checkpointed before main stops the process. */
  | { type: 'dispose' }
  | { type: 'clear-database'; database: string }
  | { type: 'database-bytes'; database: string };

/** A streamed result: its columns first, then batches of rows. A failure ends it with `SqlHostError`. */
export type LocalStreamItem = { columns: SqlColumnMetadata[] } | { rows: Array<Record<string, unknown>> };

/** The engine process's closed list of operations. A failure throws `SqlHostError`, whose detail is a `SqlLocalError`. */
export interface SqlLocalOps {
  open(owner: number, persist: boolean, paths: LocalPaths): Promise<SqlLocalOpened>;
  connect(owner: number, engineId: string): Promise<string>;
  query(owner: number, connectionId: string, sql: string): Promise<SqlLocalQueryResult>;
  rows(owner: number, connectionId: string, sql: string): AsyncIterable<LocalStreamItem>;
  cancel(owner: number, connectionId: string): Promise<boolean>;
  closeConnection(owner: number, connectionId: string): Promise<null>;
  registerFile(owner: number, engineId: string, name: string, bytes: Uint8Array): Promise<null>;
  registerEmptyFile(owner: number, engineId: string, name: string): Promise<null>;
  dropFile(owner: number, engineId: string, name: string): Promise<null>;
  readFile(owner: number, engineId: string, name: string): Promise<Uint8Array>;
  terminate(owner: number, engineId: string): Promise<null>;
  releaseOwner(owner: number): Promise<null>;
  dispose(): Promise<null>;
  clearDatabase(database: string): Promise<null>;
  databaseBytes(database: string): Promise<number | null>;
}

export const SQL_LOCAL_OPERATIONS = [
  'open',
  'connect',
  'query',
  'cancel',
  'closeConnection',
  'registerFile',
  'registerEmptyFile',
  'dropFile',
  'readFile',
  'terminate',
  'releaseOwner',
  'dispose',
  'clearDatabase',
  'databaseBytes',
] as const satisfies ReadonlyArray<keyof SqlLocalOps>;

export const SQL_LOCAL_STREAMS = ['rows'] as const satisfies ReadonlyArray<keyof SqlLocalOps>;

export const ENGINE_GONE_MESSAGE = 'The SQL engine stopped. Run the query again to start a new one.';
export const RESULT_CLOSED_MESSAGE = 'The SQL result is closed.';

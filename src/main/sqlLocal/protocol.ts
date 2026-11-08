/**
 * Messages between main and the Local SQL utilityProcess. Main stamps every
 * request with the renderer that sent it and owns every path; the process only
 * serves an id to the owner it was opened for.
 */

import type { SqlLocalError } from '../../shared/sqlLocal';

export interface LocalPaths {
  /** The persisted database file, shared by every owner but held by one engine at a time. */
  database: string;
  /** This owner's registered files: the one folder SQL may read and write. */
  files: string;
  /** Where DuckDB spills when a query outgrows memory; SQL cannot name it. */
  temp: string;
}

export type LocalRequest =
  | { id: number; type: 'open'; owner: number; persist: boolean; paths: LocalPaths }
  | { id: number; type: 'connect'; owner: number; engineId: string }
  | { id: number; type: 'query'; owner: number; connectionId: string; sql: string }
  | { id: number; type: 'stream'; owner: number; connectionId: string; sql: string }
  | { id: number; type: 'next'; owner: number; streamId: string }
  | { id: number; type: 'cancel'; owner: number; connectionId: string }
  | { id: number; type: 'close-connection'; owner: number; connectionId: string }
  | { id: number; type: 'register-file'; owner: number; engineId: string; name: string; bytes: Uint8Array }
  | { id: number; type: 'register-empty-file'; owner: number; engineId: string; name: string }
  | { id: number; type: 'drop-file'; owner: number; engineId: string; name: string }
  | { id: number; type: 'read-file'; owner: number; engineId: string; name: string }
  | { id: number; type: 'terminate'; owner: number; engineId: string }
  | { id: number; type: 'release-owner'; owner: number }
  /** Closes every engine, so the persisted file is checkpointed before main stops the process. */
  | { id: number; type: 'dispose' }
  | { id: number; type: 'clear-database'; database: string }
  | { id: number; type: 'database-bytes'; database: string };

export type LocalResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: SqlLocalError };

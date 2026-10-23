/**
 * What every engine session gives the SQL host, and the error classification
 * both the desktop host and the browser's HTTP engines use. No Node APIs, so
 * the web build runs the HTTP engines on the same contract.
 */

import type { SqlDbFixHint, SqlDbIntrospect, SqlDbIntrospectResult } from './sqlDb';
import type { SqlColumnMetadata } from './sqlWorkspace';
import { ROW_EDIT_BUDGET_MS, type RowEditFailure, type RowEditStatement } from './sqlRowEdits';

/** A failure the renderer can act on: the step a connect failed at and the fix to show. */
export interface SqlDriverError {
  message: string;
  /** Step a test failed at. */
  step?: 'tcp' | 'ssh' | 'tls' | 'auth' | 'server' | 'file';
  fix?: SqlDbFixHint;
}

/** A connect failure whose step and fix are already known, as an HTTP engine's refused token. */
export class SqlConnectError extends Error {
  constructor(
    message: string,
    readonly detail: Required<Pick<SqlDriverError, 'step' | 'fix'>>
  ) {
    super(message);
  }
}

/** An edit transaction that rolled back: a change that would touch no row or several, or one past its budget. */
export class EditFailedError extends Error {
  constructor(readonly failure: RowEditFailure) {
    super(
      failure.kind === 'conflict'
        ? `Change ${failure.change} would touch ${failure.touched} rows instead of one: the table changed since it was read, so nothing was saved.`
        : 'Applying the changes took too long, so nothing was saved.'
    );
  }
}

/** Seconds an edit waits on another session's lock before its transaction rolls back. */
export const EDIT_LOCK_WAIT_S = 10;

/** Throws once an edit transaction runs past its budget, so it rolls back instead of committing after main gave up. */
export function editDeadline(now: () => number = Date.now): () => void {
  const end = now() + ROW_EDIT_BUDGET_MS;
  return () => {
    if (now() > end) throw new EditFailedError({ kind: 'too-slow' });
  };
}

/** Checks one statement's row count inside an edit transaction. */
export function expectOneRow(index: number, touched: number | null | undefined): void {
  if (touched !== 1) throw new EditFailedError({ kind: 'conflict', change: index + 1, touched: Number(touched ?? 0) });
}

export interface DriverRows {
  columns: SqlColumnMetadata[];
  /** Rows a write touched, when the statement returned no result set. */
  affectedRows?: number;
  /** Reads up to `limit` more rows in engine order; `done` when there are none left. */
  next(limit: number): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }>;
  close(): Promise<void>;
}

export interface DriverSession {
  version(): Promise<string>;
  run(sql: string, options: { readWrite: boolean }): Promise<DriverRows>;
  /** Stops the running statement from a side connection; false when the engine cannot. */
  cancel(): Promise<boolean>;
  /** Rows the planner expects a statement to touch, or null. Never executes it. */
  estimateRows(sql: string): Promise<number | null>;
  tls?(): { subject?: string; validTo?: string } | undefined;
  /** False when the session ended up without TLS, as prefer allows. */
  encrypted?(): boolean;
  /** One level of the catalog, read with the engine's own catalog queries. */
  introspect(request: SqlDbIntrospect): Promise<SqlDbIntrospectResult>;
  /** Runs every statement in one transaction; each must touch exactly one row, or all of them roll back. */
  applyEdits(statements: ReadonlyArray<RowEditStatement>): Promise<void>;
  /** Calls `listener` when the connection drops on its own, as when its tunnel closes. */
  onLost?(listener: () => void): void;
  close(): Promise<void>;
}

/** An open result: rows read from the engine but not yet sent, and whether the engine has more. */
export interface RowPager {
  rows: DriverRows;
  pending: Array<Record<string, unknown>>;
  done: boolean;
}

const READ_BATCH = 500;

/** Fills a page within `maxRows` and `maxBytes`, keeping what did not fit for the next one. */
export async function readRowPage(
  run: RowPager,
  maxRows: number,
  maxBytes: number,
  cells: (row: Record<string, unknown>) => Record<string, unknown>,
  size: (row: Record<string, unknown>) => number
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean; bytes: number }> {
  const rows: Array<Record<string, unknown>> = [];
  let bytes = 0;
  while (rows.length < maxRows) {
    if (run.pending.length === 0) {
      if (run.done) break;
      const page = await run.rows.next(Math.min(READ_BATCH, maxRows - rows.length));
      run.pending = page.rows.map(cells);
      run.done = page.done;
      if (run.pending.length === 0) break;
    }
    const row = run.pending[0]!;
    const rowSize = size(row);
    if (rows.length > 0 && bytes + rowSize > maxBytes) break;
    rows.push(row);
    bytes += rowSize;
    run.pending.shift();
  }
  return { rows, done: run.done && run.pending.length === 0, bytes };
}

const TLS_UNTRUSTED = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_UNTRUSTED',
]);
const AUTH_CODES = new Set(['28P01', '28000', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR']);
const DATABASE_CODES = new Set(['3D000', 'ER_BAD_DB_ERROR']);
const UNREACHABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET']);

/** Names the step a connect failed at, and the fix to show, from a driver error. */
export function classifyConnectError(err: unknown): SqlDriverError {
  if (err instanceof SqlConnectError) return { message: err.message, ...err.detail };
  const record = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : String(err);
  if (TLS_UNTRUSTED.has(code) || /self[- ]signed certificate|unable to verify the first certificate|certificate has expired/i.test(message)) {
    return { message, step: 'tls', fix: 'tls-untrusted' };
  }
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /Hostname\/IP does not match certificate/i.test(message)) return { message, step: 'tls', fix: 'tls-hostname' };
  if (/does not support SSL|SSL connection is required|server does not allow insecure/i.test(message)) {
    return { message, step: 'tls', fix: 'tls-unsupported' };
  }
  // SQL Server reports a missing database as a failed login too, so the database check comes first.
  if (DATABASE_CODES.has(code) || /Cannot open database|Database \S+ does not exist|UNKNOWN_DATABASE/i.test(message)) return { message, step: 'auth', fix: 'database' };
  if (AUTH_CODES.has(code) || /password authentication failed|Access denied for user|Login failed for user|Authentication failed|AUTHENTICATION_FAILED/i.test(message)) {
    return { message, step: 'auth', fix: 'auth' };
  }
  if (/password must be a string|no password|client password must be/i.test(message)) {
    return { message, step: 'auth', fix: 'password-needed' };
  }
  if (UNREACHABLE.has(code) || /\b(?:ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b/.test(message)) return { message, step: 'tcp', fix: 'unreachable' };
  return { message, step: 'server', fix: 'unknown' };
}

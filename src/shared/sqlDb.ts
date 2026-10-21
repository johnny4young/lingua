/**
 * Renderer-facing shapes of the desktop `sql-db:*` IPC: the catalog view,
 * run results paged like the Local engine, and Test connection steps.
 */

import type { SqlColumnMetadata, SqlQueryStatus } from './sqlWorkspace';
import type { SqlConnectionDraft, SqlConnectionV1, SqlRemoteEngine } from './sqlConnections';
import type { SecretStorageMode } from './secretVault';

/** A connection as the renderer sees it: never a password, only whether one is kept. */
export interface SqlDbConnectionView extends SqlConnectionV1 {
  hasPassword: boolean;
}

export interface SqlDbCatalogView {
  connections: SqlDbConnectionView[];
  /** Session-only connections opened from a URL; they never count toward the quota. */
  adhoc: SqlDbConnectionView[];
  used: number;
  /** `null` means no limit. */
  limit: number | null;
  vault: SecretStorageMode;
}

export type SqlDbSaveResult =
  | { ok: true; connection: SqlDbConnectionView }
  | { ok: false; reason: 'invalid' | 'quota' | 'not-found' | 'secret-failed' };

/** A run target: a saved or ad-hoc connection id, or a draft being tested before save. */
export type SqlDbTarget = { connectionId: string } | { draft: SqlConnectionDraft; password?: string };

export interface SqlDbRunOptions {
  timeoutMs: number;
  /** Lift read-only for this run only; main requires the typed connection name for prod. */
  readWrite?: { confirmName: string };
}

export interface SqlDbRunResult {
  status: SqlQueryStatus;
  engine: SqlRemoteEngine;
  columns: SqlColumnMetadata[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  tooLarge: boolean;
  rowCountIsLowerBound: boolean;
  /** More rows can be read with `sql-db:fetch` under the same run id. */
  hasMore: boolean;
  durationMs: number;
  /** Rows a write touched, when the server says. */
  affectedRows?: number;
  errorMessage?: string;
}

export interface SqlDbFetchResult {
  rows: Array<Record<string, unknown>>;
  done: boolean;
  bytes: number;
  errorMessage?: string;
}

export const SQL_DB_TEST_STEPS = ['resolve', 'policy', 'file', 'tcp', 'tls', 'auth', 'server'] as const;
export type SqlDbTestStepId = (typeof SQL_DB_TEST_STEPS)[number];

export interface SqlDbTestStep {
  id: SqlDbTestStepId;
  status: 'ok' | 'failed' | 'skipped';
  /** Milliseconds, absent when the step folds into the next one. */
  ms?: number;
  /** Detail shown on screen; the copied report redacts host and user. */
  detail?: string;
  /** Stable hint key for a failed step. */
  fix?: SqlDbFixHint;
}

export const SQL_DB_FIX_HINTS = [
  'dns',
  'blocked-host',
  'unreachable',
  'tls-untrusted',
  'tls-hostname',
  'tls-unsupported',
  'auth',
  'password-needed',
  'database',
  'file-missing',
  'file-unreadable',
  'unknown',
] as const;
export type SqlDbFixHint = (typeof SQL_DB_FIX_HINTS)[number];

export interface SqlDbTestResult {
  ok: boolean;
  totalMs: number;
  steps: SqlDbTestStep[];
  /** `PostgreSQL 16.4`, `MySQL 8.4.2`, `SQLite 3.53.4`. */
  serverVersion?: string;
}

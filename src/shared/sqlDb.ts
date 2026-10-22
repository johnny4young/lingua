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
  /** Why it failed, when the renderer can act on it (ask for a password, confirm a write). */
  fix?: SqlDbFixHint;
}

export interface SqlDbFetchResult {
  rows: Array<Record<string, unknown>>;
  done: boolean;
  bytes: number;
  errorMessage?: string;
}

export type SqlDbFileKind = 'sqlite' | 'ca' | 'cert' | 'key' | 'ssh-key';
export type SqlDbPickResult = { canceled: true } | { canceled: false; path: string } | { canceled: true; blocked: true };

export const SQL_DB_TEST_STEPS = ['resolve', 'policy', 'file', 'tcp', 'ssh', 'tls', 'auth', 'server'] as const;
type SqlDbTestStepId = (typeof SQL_DB_TEST_STEPS)[number];

export interface SqlDbTestStep {
  id: SqlDbTestStepId;
  status: 'ok' | 'failed' | 'skipped';
  /** Milliseconds, absent when the step folds into the next one. */
  ms?: number;
  /** Detail shown on screen; the copied report redacts host and user. */
  detail?: string;
  /** Stable hint key for a failed step. */
  fix?: SqlDbFixHint;
  /** An SSH host key no one trusts yet, offered to trust once. */
  hostKey?: SqlDbHostKey;
}

export interface SqlDbHostKey {
  host: string;
  port: number;
  /** `SHA256:` and the unpadded base64 digest, as ssh-keygen prints it. */
  fingerprint: string;
}

const SQL_DB_FIX_HINTS = [
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
  'blocked-path',
  'confirm-needed',
  'ssh-unreachable',
  'ssh-auth',
  'ssh-key',
  'ssh-password-needed',
  'ssh-host-unknown',
  'ssh-host-changed',
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

export const SQL_DB_OBJECT_KINDS = ['table', 'view', 'matview', 'function', 'procedure', 'sequence', 'extension'] as const;
export type SqlDbObjectKind = (typeof SQL_DB_OBJECT_KINDS)[number];

/** Objects listed per schema, and columns read per schema for completion. */
export const MAX_INTROSPECT_OBJECTS = 5_000;
export const MAX_INTROSPECT_COLUMNS = 20_000;

/** One level of a connection's catalog, read on demand. */
export type SqlDbIntrospect =
  | { level: 'schemas' }
  | { level: 'objects'; schema: string }
  | { level: 'columns'; schema: string }
  /** `signature` tells function overloads apart. */
  | { level: 'detail'; schema: string; name: string; kind: SqlDbObjectKind; signature?: string };

export interface SqlDbSchemaInfo {
  name: string;
  objects: number;
}

export interface SqlDbObjectInfo {
  kind: SqlDbObjectKind;
  name: string;
  /** Planner estimate for tables and materialized views. */
  rowEstimate?: number;
  /** Arguments of a function or procedure, or an extension's version. */
  signature?: string;
}

export interface SqlDbColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  primaryKey?: boolean;
  references?: { schema: string; table: string; column: string };
}

export interface SqlDbIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface SqlDbObjectDetail {
  kind: SqlDbObjectKind;
  schema: string;
  name: string;
  columns: SqlDbColumnInfo[];
  indexes: SqlDbIndexInfo[];
  rowEstimate?: number;
  sizeBytes?: number;
  ddl?: string;
}

/** Exactly one field per level is set, or `errorMessage`. */
export interface SqlDbIntrospectResult {
  schemas?: SqlDbSchemaInfo[];
  objects?: SqlDbObjectInfo[];
  columns?: Array<{ table: string; name: string; type: string }>;
  /** The level held more than the cap; the rest is not listed. */
  truncated?: boolean;
  detail?: SqlDbObjectDetail;
  errorMessage?: string;
  fix?: SqlDbFixHint;
}

/** `window.lingua.db` on desktop; absent on the web build. */
export interface SqlDbBridge {
  catalog(): Promise<SqlDbCatalogView>;
  save(draft: SqlConnectionDraft, id?: string, password?: string): Promise<SqlDbSaveResult>;
  delete(id: string): Promise<{ ok: boolean }>;
  openAdhoc(draft: SqlConnectionDraft, password?: string): Promise<SqlDbSaveResult>;
  sessionPassword(id: string, password: string): Promise<{ ok: boolean }>;
  test(target: SqlDbTarget): Promise<SqlDbTestResult>;
  execute(runId: string, connectionId: string, sql: string, options: SqlDbRunOptions): Promise<SqlDbRunResult>;
  fetch(runId: string, limit: number, maxBytes: number): Promise<SqlDbFetchResult>;
  cancel(runId: string): Promise<{ cancelled: boolean }>;
  closeRun(runId: string): Promise<{ ok: true }>;
  estimate(connectionId: string, sql: string): Promise<number | null>;
  pickFile(kind: SqlDbFileKind): Promise<SqlDbPickResult>;
  introspect(connectionId: string, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult>;
}


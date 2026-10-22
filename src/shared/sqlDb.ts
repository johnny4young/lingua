/**
 * Renderer-facing shapes of the desktop `sql-db:*` IPC: the catalog view,
 * run results paged like the Local engine, and Test connection steps.
 */

import type { SqlColumnMetadata, SqlQueryStatus } from './sqlWorkspace';
import type { SqlConnectionDraft, SqlConnectionV1, SqlRemoteEngine } from './sqlConnections';
import type { RowEditChanges, RowEditFailure } from './sqlRowEdits';
import type { SecretStorageMode } from './secretVault';

/** A connection as the renderer sees it: never a password, only whether one is kept. */
export interface SqlDbConnectionView extends SqlConnectionV1 {
  hasPassword: boolean;
  /** Set for a tunnel that signs in with a password or key passphrase: whether one is kept. */
  hasSshSecret?: boolean;
}

/** Which secret a session-only prompt answers. */
export type SqlDbSecretKind = 'database' | 'ssh';

/** What the sheet may learn about an SSH alias: ~/.ssh/config settings and whether an agent answers. */
export interface SqlDbSshInfo {
  config: {
    alias: string;
    hostName?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    proxyJump?: Array<{ host: string; user?: string; port?: number }>;
  } | null;
  agent: { available: boolean; keys?: number };
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
export type SqlDbTarget = { connectionId: string } | { draft: SqlConnectionDraft; password?: string; sshPassword?: string };

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

/** Where an import reads connections from; `lingua` is Lingua's own export. */
export const SQL_DB_IMPORT_SOURCES = ['tableplus', 'dbeaver', 'datagrip', 'lingua'] as const;
export type SqlDbImportSource = (typeof SQL_DB_IMPORT_SOURCES)[number];

/** A connection an import found, never with a password. */
export interface SqlDbImportCandidate {
  draft: SqlConnectionDraft;
  /** Where in the file it came from when the name alone does not say, e.g. the .env key. */
  origin?: string;
}

export type SqlDbImportResult =
  | { canceled: true }
  | {
      canceled: false;
      found: SqlDbImportCandidate[];
      /** Entries left out: other engines, missing hosts, files or SSH users, tunnels kept elsewhere, or past the cap. */
      skipped: number;
      error?: 'unreadable' | 'unrecognized';
    };

type SqlDbExportResult = { canceled: true } | { canceled: false; ok: boolean; count: number };

/** The table staged edits apply to, as the Explorer opened it. */
export interface SqlDbEditTable {
  schema: string;
  name: string;
}

export type SqlDbApplyResult =
  | { ok: true; applied: number }
  | {
      ok: false;
      /** read-only and production connections are never edited; not-editable: no whole primary key. */
      reason: 'read-only' | 'production' | 'confirm-needed' | 'not-editable' | 'invalid' | 'failed';
      message?: string;
      fix?: SqlDbFixHint;
      edit?: RowEditFailure;
    };

/** `window.lingua.db` on desktop; absent on the web build. */
export interface SqlDbBridge {
  catalog(): Promise<SqlDbCatalogView>;
  save(draft: SqlConnectionDraft, id?: string, password?: string, sshPassword?: string): Promise<SqlDbSaveResult>;
  delete(id: string): Promise<{ ok: boolean }>;
  openAdhoc(draft: SqlConnectionDraft, password?: string, sshPassword?: string): Promise<SqlDbSaveResult>;
  sessionPassword(id: string, password: string, kind?: SqlDbSecretKind): Promise<{ ok: boolean }>;
  trustHostKey(host: string, port: number, fingerprint: string): Promise<{ ok: boolean }>;
  sshInfo(alias: string): Promise<SqlDbSshInfo>;
  test(target: SqlDbTarget): Promise<SqlDbTestResult>;
  execute(runId: string, connectionId: string, sql: string, options: SqlDbRunOptions): Promise<SqlDbRunResult>;
  fetch(runId: string, limit: number, maxBytes: number): Promise<SqlDbFetchResult>;
  cancel(runId: string): Promise<{ cancelled: boolean }>;
  closeRun(runId: string): Promise<{ ok: true }>;
  estimate(connectionId: string, sql: string): Promise<number | null>;
  pickFile(kind: SqlDbFileKind): Promise<SqlDbPickResult>;
  introspect(connectionId: string, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult>;
  /** Asks for another client's file in a native dialog and lists what it holds. */
  importFile(source: SqlDbImportSource): Promise<SqlDbImportResult>;
  /** Database URLs in the open project's .env files, without their passwords. */
  importEnv(rootId: string): Promise<SqlDbImportResult>;
  /** Writes every saved connection, without secrets, to a JSON file the user names. */
  exportCatalog(): Promise<SqlDbExportResult>;
  /** Applies staged edits to one table in one transaction; main rebuilds the SQL and checks the primary key itself. */
  applyEdits(connectionId: string, table: SqlDbEditTable, changes: RowEditChanges, confirmName?: string): Promise<SqlDbApplyResult>;
}


/**
 * Messages between main and the SQL host utilityProcess. Main resolves and
 * checks the host, reads the password from the secret store and sends one
 * config per request; the host keeps one session per connection id.
 */

import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import type { SqlConnectionD1, SqlRemoteEngine, SqlSshAuth, SqlSslMode } from '../../shared/sqlConnections';
import type { SqlDbHostKey, SqlDbIntrospect } from '../../shared/sqlDb';
import type { SqlDriverError } from '../../shared/sqlDriver';
import type { RowEditFailure, RowEditStatement } from '../../shared/sqlRowEdits';
import type { KnownHostKey } from '../sqlSsh/knownHosts';

export interface HostSshHop {
  /** The first hop is the address main resolved and checked; later hops are names the previous hop resolves. */
  host: string;
  port: number;
  user: string;
  /** Keys trusted for this hop, from known_hosts and Lingua's store. */
  known: KnownHostKey[];
  /** The hop as the user named it, for errors and the trust prompt. */
  label: { host: string; port: number };
}

export interface HostSshConfig {
  /** Jump hosts, then the bastion. */
  hops: HostSshHop[];
  auth: SqlSshAuth;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Agent socket or pipe. */
  agent?: string;
  /** The database as the bastion reaches it. */
  target: { host: string; port: number };
}

export interface HostSessionConfig {
  connectionId: string;
  engine: SqlRemoteEngine;
  /** Pinned IP main resolved and checked; the driver connects here. */
  address?: string;
  /** Hostname for TLS SNI and identity checks. */
  servername?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: { mode: SqlSslMode; caPath?: string; certPath?: string; keyPath?: string };
  /** SQLite file. */
  path?: string;
  /** The database host as named, when requests go to another one: Neon's API host is `servername`. */
  host?: string;
  /** Cloudflare D1's account and database. */
  d1?: SqlConnectionD1;
  /** Tunnel to the database; each driver socket is then one of its channels. */
  ssh?: HostSshConfig;
  readOnly: boolean;
}

interface HostWindow {
  maxRows: number;
  maxBytes: number;
}

export type HostRequest =
  | { id: number; type: 'test'; config: HostSessionConfig }
  | {
      id: number;
      type: 'execute';
      config: HostSessionConfig;
      runId: string;
      sql: string;
      readWrite: boolean;
      window: HostWindow;
    }
  | { id: number; type: 'fetch'; runId: string; limit: number; maxBytes: number }
  | { id: number; type: 'close-run'; runId: string }
  | { id: number; type: 'cancel'; runId: string }
  | { id: number; type: 'estimate'; config: HostSessionConfig; sql: string }
  | { id: number; type: 'introspect'; config: HostSessionConfig; request: SqlDbIntrospect }
  | { id: number; type: 'apply-edits'; config: HostSessionConfig; statements: RowEditStatement[] }
  | { id: number; type: 'disconnect'; connectionId: string };

export interface HostTestResult {
  tcpMs?: number;
  /** Handshake, sign-in and forwarding through every hop. */
  sshMs?: number;
  connectMs: number;
  serverMs: number;
  serverVersion: string;
  tls?: { subject?: string; validTo?: string };
  /** False when the session runs without TLS. */
  encrypted?: boolean;
}

export interface HostExecuteResult {
  columns: SqlColumnMetadata[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  tooLarge: boolean;
  rowCountIsLowerBound: boolean;
  hasMore: boolean;
  affectedRows?: number;
}

export interface HostFetchResult {
  rows: Array<Record<string, unknown>>;
  done: boolean;
  bytes: number;
}

/** `restart` asks main to restart the host: the engine cannot stop a statement any other way. */
export interface HostCancelResult {
  cancelled: boolean;
  restart?: boolean;
}

export interface HostError extends SqlDriverError {
  /** The key a hop presented that no one trusts yet. */
  hostKey?: SqlDbHostKey & { type: string };
  cancelled?: boolean;
  /** Why staged edits rolled back. */
  edit?: RowEditFailure;
}

export type HostResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: HostError };

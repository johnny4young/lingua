/**
 * Messages between main and the SQL host utilityProcess. Main resolves and
 * checks the host, reads the password from the secret store and sends one
 * config per request; the host keeps one session per connection id.
 */

import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import type { SqlRemoteEngine, SqlSslMode } from '../../shared/sqlConnections';
import type { SqlDbFixHint, SqlDbIntrospect } from '../../shared/sqlDb';

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
  | { id: number; type: 'disconnect'; connectionId: string };

export interface HostTestResult {
  tcpMs?: number;
  connectMs: number;
  serverMs: number;
  serverVersion: string;
  tls?: { subject?: string; validTo?: string };
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

export interface HostError {
  message: string;
  /** Step a test failed at. */
  step?: 'tcp' | 'tls' | 'auth' | 'server' | 'file';
  fix?: SqlDbFixHint;
  cancelled?: boolean;
}

export type HostResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: HostError };

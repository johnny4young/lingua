/** What every engine adapter gives the host, plus cell mapping and error classification. */

import type { SqlDbIntrospect, SqlDbIntrospectResult } from '../../shared/sqlDb';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import type { HostError, HostSessionConfig } from './protocol';

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
  /** One level of the catalog, read with the engine's own catalog queries. */
  introspect(request: SqlDbIntrospect): Promise<SqlDbIntrospectResult>;
  close(): Promise<void>;
}

export type DriverFactory = (config: HostSessionConfig) => Promise<DriverSession>;

/** A cell as the grid takes it: text for wide numbers and dates, base64 for bytes. */
export function toJsonCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  if (Array.isArray(value)) return value.map(toJsonCell);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = toJsonCell(item);
  return out;
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
export function classifyConnectError(err: unknown): HostError {
  const record = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : String(err);
  if (TLS_UNTRUSTED.has(code)) return { message, step: 'tls', fix: 'tls-untrusted' };
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return { message, step: 'tls', fix: 'tls-hostname' };
  if (/does not support SSL|SSL connection is required|server does not allow insecure/i.test(message)) {
    return { message, step: 'tls', fix: 'tls-unsupported' };
  }
  if (AUTH_CODES.has(code) || /password authentication failed|Access denied for user/i.test(message)) {
    return { message, step: 'auth', fix: 'auth' };
  }
  if (/password must be a string|no password|client password must be/i.test(message)) {
    return { message, step: 'auth', fix: 'password-needed' };
  }
  if (DATABASE_CODES.has(code)) return { message, step: 'auth', fix: 'database' };
  if (UNREACHABLE.has(code)) return { message, step: 'tcp', fix: 'unreachable' };
  return { message, step: 'server', fix: 'unknown' };
}

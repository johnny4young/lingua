/**
 * Cloudflare D1 through its REST API (`/raw`). The API has no read-only mode
 * and runs every statement in the text, so a read-only connection runs only
 * proven reads, here as well as in the run guard. No staged edits: the API
 * gives no transaction to check each change in.
 */

import { introspectSqlite } from '../sqlCatalog/sqlite';
import { SqlConnectError, type DriverSession } from '../sqlDriver';
import { isWriteSqlStatementOn } from '../sqlStatements';
import { HttpSqlError, inflight, parseJson, rowObject, send, summary, wholeRows, type HttpSqlTransport } from './transport';

export interface D1Target {
  /** `https://api.cloudflare.com`. */
  origin: string;
  accountId: string;
  databaseId: string;
  token: string;
  readOnly: boolean;
}

interface D1Answer {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: Array<{ results?: { columns?: string[]; rows?: unknown[][] }; meta?: { changes?: number } }>;
}

/** Cloudflare's code for a database the token's account does not hold. */
const NO_DATABASE = 7404;

function base64(bytes: unknown[]): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(Number(byte) & 0xff);
  return btoa(binary);
}

// D1 sends a BLOB as an array of byte values.
const cell = (value: unknown) => (Array.isArray(value) ? base64(value) : value ?? null);

/** D1 sends no column types, so each is named from the first value that is not null. */
function columnType(rows: unknown[][], index: number): string {
  const sample = rows.find((row) => row[index] !== null && row[index] !== undefined)?.[index];
  if (typeof sample === 'number') return Number.isInteger(sample) ? 'BIGINT' : 'DOUBLE';
  if (Array.isArray(sample)) return 'BLOB';
  return sample === undefined ? 'VALUE' : 'TEXT';
}

export async function openD1(target: D1Target, transport: HttpSqlTransport): Promise<DriverSession> {
  const requests = inflight();
  const url = `${target.origin.replace(/\/+$/, '')}/client/v4/accounts/${encodeURIComponent(target.accountId)}/d1/database/${encodeURIComponent(target.databaseId)}/raw`;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${target.token}` };

  /** The last statement's columns, rows and changes. */
  async function raw(sql: string, params: unknown[], signal: AbortSignal) {
    const response = await send(transport, { url, headers, body: JSON.stringify({ sql, params }), signal });
    const answer = parseJson<D1Answer>(response);
    if (!answer.success || response.status !== 200) {
      const error = answer.errors?.[0];
      if (error?.code === NO_DATABASE || response.status === 404) throw new SqlConnectError(error?.message ?? 'D1 database not found.', { step: 'auth', fix: 'database' });
      throw new HttpSqlError(error?.message ?? `D1 answered HTTP ${response.status}: ${summary(response.body)}`, error?.code !== undefined ? String(error.code) : undefined);
    }
    const last = answer.result?.[answer.result.length - 1];
    const columns = last?.results?.columns ?? [];
    const rows = last?.results?.rows ?? [];
    return { columns, rows, changes: last?.meta?.changes };
  }

  const query = async (sql: string, values: unknown[], signal: AbortSignal) => {
    const result = await raw(sql, values, signal);
    return result.rows.map((row) => rowObject(result.columns, row.map(cell)));
  };

  // The first request proves the token and the ids, so a refusal reads as a failed connect.
  const [versionRow] = await requests.run((signal) => query('SELECT sqlite_version() AS v', [], signal));
  const version = `D1 (SQLite ${String(versionRow?.v ?? '')})`;

  return {
    version: async () => version,

    run: (sql, { readWrite }) =>
      requests.run(async (signal) => {
        if (target.readOnly && !readWrite && isWriteSqlStatementOn('d1', sql)) {
          throw new HttpSqlError('This connection is read-only, and on D1 it runs one SELECT, WITH or VALUES statement at a time.');
        }
        const result = await raw(sql, [], signal);
        const columns = result.columns.map((name, index) => ({ name, type: columnType(result.rows, index) }));
        const rows = result.rows.map((row) => rowObject(result.columns, row.map(cell)));
        return wholeRows(columns, rows, columns.length === 0 ? result.changes : undefined);
      }),

    async cancel() {
      requests.cancel();
      return true;
    },

    estimateRows: async () => null,

    encrypted: () => true,

    introspect: (request) => requests.run((signal) => introspectSqlite((sql, values) => query(sql, values, signal), request, { cloudflare: true })),

    async applyEdits() {
      throw new HttpSqlError('D1 does not take staged edits.');
    },

    async close() {
      requests.cancel();
    },
  };
}

/**
 * Neon's SQL over HTTP (`/sql` on its API host). Every request is its own
 * transaction: a read-only connection sends each run as a read-only batch the
 * server enforces, and staged edits go as one batch that rolls back whole.
 */

import { explainRowEstimate, introspectPostgres, postgresColumnType } from '../sqlCatalog/postgres';
import { EDIT_LOCK_WAIT_S, EditFailedError, type DriverSession } from '../sqlDriver';
import { ROW_EDIT_BUDGET_MS, type RowEditStatement } from '../sqlRowEdits';
import { HttpSqlError, inflight, parseJson, rowObject, send, summary, wholeRows, type HttpSqlTransport } from './transport';

export interface NeonTarget {
  /** `https://api.<region>.neon.tech`, where Neon answers SQL over HTTP. */
  origin: string;
  /** The database's own host, which the connection string names. */
  host: string;
  database?: string;
  user?: string;
  password?: string;
  readOnly: boolean;
}

interface NeonField {
  name: string;
  dataTypeID: number;
  dataTypeModifier?: number;
}

interface NeonResult {
  fields: NeonField[];
  rows: Array<Array<string | null>>;
  rowCount: number | null;
  command?: string;
}

interface NeonQuery {
  query: string;
  params: Array<string | null>;
}

const NUMBER_OIDS = new Set([21, 23, 26, 700, 701]);
const CONFLICT = /lingua-edit-conflict-(\d+)-(\d+)/;
const TOO_SLOW = 'lingua-edit-too-slow';

function hexToBase64(hex: string): string {
  let binary = '';
  for (let index = 0; index + 1 < hex.length; index += 2) binary += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
  return btoa(binary);
}

/** Text as Neon sends it, as the desktop's Postgres driver hands it over: wide numbers and dates stay text. */
function cell(value: string | null, oid: number): unknown {
  if (value === null) return null;
  if (oid === 16) return value === 't';
  if (NUMBER_OIDS.has(oid)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (oid === 17 && value.startsWith('\\x')) return hexToBase64(value.slice(2));
  return value;
}

const rowsOf = (result: NeonResult) => {
  const names = result.fields.map((field) => field.name);
  return result.rows.map((row) => rowObject(names, row.map((value, index) => cell(value, result.fields[index]?.dataTypeID ?? 25))));
};

const plain = (query: string, params: Array<string | null> = []): NeonQuery => ({ query, params });

export async function openNeon(target: NeonTarget, transport: HttpSqlTransport): Promise<DriverSession> {
  const requests = inflight();
  const credentials = `${encodeURIComponent(target.user ?? '')}${target.password !== undefined ? `:${encodeURIComponent(target.password)}` : ''}`;
  const connectionString = `postgresql://${credentials}@${target.host}/${encodeURIComponent(target.database ?? '')}?sslmode=require`;
  const url = `${target.origin.replace(/\/+$/, '')}/sql`;

  async function post<T>(body: NeonQuery | { queries: NeonQuery[] }, signal: AbortSignal, readOnly?: boolean): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'Neon-Connection-String': connectionString,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
      ...('queries' in body && readOnly !== undefined ? { 'Neon-Batch-Read-Only': String(readOnly) } : {}),
    };
    const response = await send(transport, { url, headers, body: JSON.stringify(body), signal });
    if (response.status === 200) return parseJson<T>(response);
    // Neon sends Postgres errors as JSON with their SQLSTATE, a missing database with a 500.
    let error: { message?: unknown; code?: unknown } = {};
    try {
      error = JSON.parse(response.body) as typeof error;
    } catch {
      // A plain-text answer is the message itself.
    }
    if (typeof error.message === 'string') throw new HttpSqlError(error.message, typeof error.code === 'string' ? error.code : undefined);
    throw new HttpSqlError(`Neon answered HTTP ${response.status}: ${summary(response.body)}`);
  }

  /** Queries in one transaction; the last one's result. */
  async function batch(queries: NeonQuery[], signal: AbortSignal, readOnly: boolean): Promise<NeonResult> {
    const answer = await post<{ results: NeonResult[] }>({ queries }, signal, readOnly);
    const last = answer.results?.[queries.length - 1];
    if (!last) throw new HttpSqlError('Neon sent fewer results than queries.');
    return last;
  }

  const one = (sql: string, signal: AbortSignal) => (target.readOnly ? batch([plain(sql)], signal, true) : post<NeonResult>(plain(sql), signal));

  // The first request proves the address and the password, so a refusal reads as a failed connect.
  const shown = await requests.run((signal) => one('SHOW server_version', signal));
  const version = `PostgreSQL ${String(shown.rows[0]?.[0] ?? '').split(' ')[0]} (Neon)`;

  return {
    version: async () => version,

    run: (sql, { readWrite }) =>
      requests.run(async (signal) => {
        // Lifting read-only runs one request as its own read-write transaction.
        const result = target.readOnly && !readWrite ? await batch([plain(sql)], signal, true) : await post<NeonResult>(plain(sql), signal);
        const fields = result.fields ?? [];
        const columns = fields.map((field) => ({ name: field.name, type: postgresColumnType(field.dataTypeID, field.dataTypeModifier) }));
        return wholeRows(columns, rowsOf({ ...result, fields }), columns.length === 0 && result.rowCount !== null ? result.rowCount : undefined);
      }),

    async cancel() {
      requests.cancel();
      return true;
    },

    estimateRows: (sql) =>
      requests.run(async (signal) => {
        try {
          const result = await batch([plain(`EXPLAIN (FORMAT JSON) ${sql}`)], signal, true);
          return explainRowEstimate(result.rows[0]?.[0]);
        } catch {
          return null;
        }
      }),

    encrypted: () => true,

    introspect: (request) =>
      requests.run((signal) =>
        // Catalog functions resolve in pg_catalog only, as on the desktop driver.
        introspectPostgres(
          async (sql, values) =>
            rowsOf(
              await batch(
                [plain('SET LOCAL search_path = pg_catalog, pg_temp'), plain('SET LOCAL statement_timeout = 25000'), plain(sql, values.map((value) => (value === null || value === undefined ? null : String(value))))],
                signal,
                true
              )
            ),
          request
        )
      ),

    applyEdits: (statements) => requests.run((signal) => applyEdits(statements, signal)),

    async close() {
      requests.cancel();
    },
  };

  /**
   * One batch, so one transaction: each change fails the cast in its own
   * check unless it touched exactly one row, and a last check fails a
   * transaction that ran past its budget, so it never commits late.
   */
  async function applyEdits(statements: ReadonlyArray<RowEditStatement>, signal: AbortSignal): Promise<void> {
    const budget = ROW_EDIT_BUDGET_MS / 2;
    const queries = [
      plain(`SET LOCAL lock_timeout = '${EDIT_LOCK_WAIT_S}s'`),
      plain(`SET LOCAL statement_timeout = '${budget}ms'`),
      ...statements.map((statement, index) =>
        plain(
          `WITH changed AS (${statement.sql} RETURNING 1) SELECT CASE WHEN count(*) = 1 THEN 1 ELSE CAST('lingua-edit-conflict-${index + 1}-' || count(*) AS integer) END FROM changed`,
          statement.params
        )
      ),
      // A constant cast would fail at plan time, so the failing branch reads the clock too.
      plain(`SELECT CASE WHEN clock_timestamp() - transaction_timestamp() < interval '${budget} milliseconds' THEN 1 ELSE CAST('${TOO_SLOW} ' || clock_timestamp() AS integer) END`),
    ];
    try {
      await batch(queries, AbortSignal.any([signal, AbortSignal.timeout(ROW_EDIT_BUDGET_MS)]), false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const conflict = CONFLICT.exec(message);
      if (conflict) throw new EditFailedError({ kind: 'conflict', change: Number(conflict[1]), touched: Number(conflict[2]) });
      if (message.includes(TOO_SLOW)) throw new EditFailedError({ kind: 'too-slow' });
      throw err;
    }
  }
}

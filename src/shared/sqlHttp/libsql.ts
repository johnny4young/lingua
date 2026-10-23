/**
 * Turso and other libSQL servers over Hrana's HTTP pipeline (`/v2/pipeline`).
 * Each run is its own stream, closed in the same request, so nothing carries
 * from one statement to the next; staged edits keep one stream open with its
 * baton until they commit or roll back.
 */

import { introspectSqlite, sqliteColumnType } from '../sqlCatalog/sqlite';
import { editDeadline, expectOneRow, type DriverSession } from '../sqlDriver';
import type { RowEditStatement, RowEditValue } from '../sqlRowEdits';
import { HttpSqlError, inflight, parseJson, rowObject, send, summary, wholeRows, type HttpSqlTransport } from './transport';

export interface LibsqlTarget {
  /** `https://host[:port]`, or `http://` for a local server. */
  origin: string;
  token?: string;
  readOnly: boolean;
}

type HranaValue =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }
  | { type: 'blob'; base64: string };

interface HranaStmtResult {
  cols: Array<{ name: string | null; decltype?: string | null }>;
  rows: HranaValue[][];
  affected_row_count: number;
}

interface HranaError {
  message: string;
  code?: string;
}

type HranaResult =
  | { type: 'ok'; response: { type: string; result?: unknown } }
  | { type: 'error'; error: HranaError };

interface PipelineResponse {
  baton: string | null;
  base_url: string | null;
  results: HranaResult[];
}

interface HranaStmt {
  sql: string;
  args?: HranaValue[];
  want_rows?: boolean;
}

type HranaRequest =
  | { type: 'execute'; stmt: HranaStmt }
  | { type: 'describe'; sql: string }
  | { type: 'batch'; batch: { steps: Array<{ condition?: { type: 'ok'; step: number }; stmt: HranaStmt }> } }
  | { type: 'close' };

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** A cell as the grid takes it: integers past 2^53 as text, blobs as base64. */
function cell(value: HranaValue | undefined): unknown {
  switch (value?.type) {
    case 'integer': {
      const big = BigInt(value.value);
      return big <= SAFE && big >= -SAFE ? Number(big) : value.value;
    }
    case 'float':
    case 'text':
      return value.value;
    case 'blob':
      // Hrana leaves the padding off; the grid gets base64 as the file driver writes it.
      return value.base64.padEnd(Math.ceil(value.base64.length / 4) * 4, '=');
    default:
      return null;
  }
}

// A staged value is text the column's affinity converts, as the file driver binds it.
const arg = (value: RowEditValue): HranaValue => (value === null ? { type: 'null' } : { type: 'text', value });

const failure = (error: HranaError) => new HttpSqlError(error.message, error.code);

function okResult(result: HranaResult | undefined): unknown {
  if (!result) throw new HttpSqlError('The libSQL server sent fewer results than requests.');
  if (result.type === 'error') throw failure(result.error);
  return result.response.result;
}

export async function openLibsql(target: LibsqlTarget, transport: HttpSqlTransport): Promise<DriverSession> {
  const requests = inflight();
  const origin = target.origin.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(target.token ? { authorization: `Bearer ${target.token}` } : {}) };

  async function pipeline(list: HranaRequest[], baton: string | null, signal: AbortSignal): Promise<PipelineResponse> {
    const response = await send(transport, { url: `${origin}/v2/pipeline`, headers, body: JSON.stringify({ baton, requests: list }), signal });
    if (response.status === 404) throw new HttpSqlError(`No libSQL server answers at ${origin} (HTTP 404).`);
    if (response.status !== 200) throw new HttpSqlError(`The libSQL server answered HTTP ${response.status}: ${summary(response.body)}`);
    return parseJson<PipelineResponse>(response);
  }

  /** One statement on a stream of its own, closed in the same request. */
  async function execute(stmt: HranaStmt, signal: AbortSignal): Promise<HranaStmtResult> {
    const answer = await pipeline([{ type: 'execute', stmt: { want_rows: true, ...stmt } }, { type: 'close' }], null, signal);
    return okResult(answer.results[0]) as HranaStmtResult;
  }

  const rowsOf = (result: HranaStmtResult) => {
    const names = result.cols.map((column, index) => column.name ?? `column${index + 1}`);
    return result.rows.map((row) => rowObject(names, row.map(cell)));
  };

  const query = (sql: string, values: unknown[], signal: AbortSignal) =>
    execute({ sql, args: values.map((value) => (value === null || value === undefined ? { type: 'null' as const } : { type: 'text' as const, value: String(value) })) }, signal).then(rowsOf);

  // The first request proves the address and the token, so a refusal reads as a failed connect.
  const [versionRow] = await requests.run((signal) => query('SELECT sqlite_version() AS v', [], signal));
  const version = `libSQL (SQLite ${String(versionRow?.v ?? '')})`;

  return {
    version: async () => version,

    run: (sql, { readWrite }) =>
      requests.run(async (signal) => {
        let result: HranaStmtResult;
        if (target.readOnly && !readWrite) {
          // SQLite's own readonly flag, then the run inside a transaction that always rolls back.
          const described = await pipeline([{ type: 'describe', sql }, { type: 'close' }], null, signal);
          const description = okResult(described.results[0]) as { is_readonly?: boolean };
          if (description.is_readonly !== true) throw new HttpSqlError('This connection is read-only, and this statement may write.');
          const answer = await pipeline(
            [
              { type: 'execute', stmt: { sql: 'BEGIN' } },
              { type: 'execute', stmt: { sql, want_rows: true } },
              { type: 'execute', stmt: { sql: 'ROLLBACK' } },
              { type: 'close' },
            ],
            null,
            signal
          );
          okResult(answer.results[0]);
          result = okResult(answer.results[1]) as HranaStmtResult;
        } else {
          result = await execute({ sql }, signal);
        }
        const columns = result.cols.map((column, index) => ({ name: column.name ?? `column${index + 1}`, type: sqliteColumnType(column.decltype) }));
        return wholeRows(columns, rowsOf(result), columns.length === 0 ? result.affected_row_count : undefined);
      }),

    async cancel() {
      requests.cancel();
      return true;
    },

    estimateRows: async () => null,

    encrypted: () => origin.startsWith('https:'),

    introspect: (request) => requests.run((signal) => introspectSqlite((sql, values) => query(sql, values, signal), request)),

    applyEdits: (statements) => requests.run((signal) => applyEdits(statements, signal)),

    async close() {
      requests.cancel();
    },
  };

  /**
   * One stream: every change in a batch that stops at the first failure, the
   * counts checked here, then COMMIT or ROLLBACK on the same baton.
   */
  async function applyEdits(statements: ReadonlyArray<RowEditStatement>, signal: AbortSignal): Promise<void> {
    const inTime = editDeadline();
    const steps = [
      { stmt: { sql: 'BEGIN IMMEDIATE' } },
      ...statements.map((statement, index) => ({ condition: { type: 'ok' as const, step: index }, stmt: { sql: statement.sql, args: statement.params.map(arg) } })),
    ];
    const opened = await pipeline([{ type: 'batch', batch: { steps } }], null, signal);
    const baton = opened.baton;
    const end = (sql: 'COMMIT' | 'ROLLBACK') => pipeline([{ type: 'execute', stmt: { sql } }, { type: 'close' }], baton, signal);
    try {
      const batch = okResult(opened.results[0]) as { step_results: Array<HranaStmtResult | null>; step_errors: Array<HranaError | null> };
      const error = batch.step_errors.find((item): item is HranaError => item !== null);
      if (error) throw failure(error);
      statements.forEach((_, index) => expectOneRow(index, batch.step_results[index + 1]?.affected_row_count));
      inTime();
      if (!baton) throw new HttpSqlError('The libSQL server closed the transaction before it could commit.');
    } catch (err) {
      if (baton) await end('ROLLBACK').catch(() => undefined);
      throw err;
    }
    okResult((await end('COMMIT')).results[0]);
  }
}

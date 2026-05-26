/**
 * RL-097 Slice 2 — duckdbClient tests with an injected mock engine.
 *
 * Exercises: happy path, sql-error classification, soft timeout via
 * Promise.race, too-large flag, engine-load-failed, multi-statement
 * counting, sanitiseRowForJson for BigInt + Date + nested values.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __setDuckDbEngineFactoryForTests,
  countSqlStatements,
  executeQuery,
  mapArrowTable,
  type ArrowTableLike,
  type DuckDbConnection,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';
import {
  MAX_RESULT_PREVIEW_BYTES,
  MAX_RESULT_ROWS,
} from '../../../src/shared/sqlWorkspace';

function arrowTableFrom(
  columns: ReadonlyArray<{ name: string; type: string }>,
  rows: ReadonlyArray<Record<string, unknown>>
): ArrowTableLike {
  return {
    numRows: rows.length,
    schema: { fields: columns.map((c) => ({ name: c.name, type: { toString: () => c.type } })) },
    toArray: () => [...rows],
  };
}

function mockEngine(impl: (sql: string) => Promise<ArrowTableLike>): DuckDbEngineHandle {
  return {
    connect: async (): Promise<DuckDbConnection> => ({
      query: async (sql) => {
        const table = await impl(sql);
        return mapArrowTable(table);
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

afterEach(() => {
  __setDuckDbEngineFactoryForTests(null);
});

describe('countSqlStatements', () => {
  it('counts single statements', () => {
    expect(countSqlStatements('SELECT 1')).toBe(1);
    expect(countSqlStatements('SELECT 1;')).toBe(1);
  });
  it('counts multi-statement input', () => {
    expect(countSqlStatements('SELECT 1; SELECT 2;')).toBe(2);
  });
  it('ignores semicolons inside string literals', () => {
    expect(countSqlStatements("SELECT ';' AS sep;")).toBe(1);
  });
  it('handles empty input', () => {
    expect(countSqlStatements('')).toBe(0);
  });
});

describe('mapArrowTable', () => {
  it('maps a small Arrow table to rows + columns', () => {
    const table = arrowTableFrom(
      [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'VARCHAR' },
      ],
      [
        { id: 1, name: 'one' },
        { id: 2, name: 'two' },
      ]
    );
    const out = mapArrowTable(table);
    expect(out.rows).toHaveLength(2);
    expect(out.columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(out.rowCount).toBe(2);
    expect(out.tooLarge).toBe(false);
  });

  it('flags tooLarge when row count exceeds MAX_RESULT_ROWS', () => {
    const oversized = Array.from({ length: MAX_RESULT_ROWS + 1 }, (_, i) => ({ i }));
    const table = arrowTableFrom([{ name: 'i', type: 'INTEGER' }], oversized);
    const out = mapArrowTable(table);
    expect(out.rows.length).toBe(MAX_RESULT_ROWS);
    expect(out.rowCount).toBe(MAX_RESULT_ROWS + 1);
    expect(out.tooLarge).toBe(true);
  });

  it('serialises BigInt as string', () => {
    const table = arrowTableFrom(
      [{ name: 'big', type: 'BIGINT' }],
      [{ big: 9007199254740993n }]
    );
    const out = mapArrowTable(table);
    expect(out.rows[0]?.big).toBe('9007199254740993');
  });

  it('serialises Date as ISO string', () => {
    const date = new Date('2026-05-26T00:00:00.000Z');
    const table = arrowTableFrom([{ name: 'd', type: 'DATE' }], [{ d: date }]);
    const out = mapArrowTable(table);
    expect(out.rows[0]?.d).toBe('2026-05-26T00:00:00.000Z');
  });

  it('enforces the preview cap with UTF-8 bytes, not UTF-16 code units', () => {
    const row = { label: '界'.repeat(1024) };
    const rowUtf16Units = JSON.stringify(row).length;
    const rowUtf8Bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    const rowsThatFitByUtf16 = Math.floor(MAX_RESULT_PREVIEW_BYTES / rowUtf16Units);
    const rows = Array.from({ length: rowsThatFitByUtf16 }, () => row);

    expect(rowUtf8Bytes).toBeGreaterThan(rowUtf16Units);

    const out = mapArrowTable(
      arrowTableFrom([{ name: 'label', type: 'VARCHAR' }], rows)
    );

    expect(out.tooLarge).toBe(true);
    expect(out.rows.length).toBeLessThan(rowsThatFitByUtf16);
  });
});

describe('executeQuery', () => {
  it('returns success for a happy-path query', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        mockEngine(async () =>
          arrowTableFrom(
            [{ name: 'a', type: 'INTEGER' }],
            [{ a: 1 }, { a: 2 }]
          )
        )
      )
    );
    const outcome = await executeQuery('SELECT a FROM gen');
    expect(outcome.status).toBe('success');
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rowCount).toBe(2);
  });

  it('returns sql-error when the connection rejects', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => {
            throw new Error('syntax error');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const outcome = await executeQuery('NOT VALID SQL');
    expect(outcome.status).toBe('sql-error');
    expect(outcome.errorMessage).toContain('syntax error');
  });

  it('normalizes DuckDB-WASM internal rejection messages', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => {
            throw new ReferenceError('_setThrew is not defined');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const outcome = await executeQuery('SELEC 1;');
    expect(outcome.status).toBe('sql-error');
    expect(outcome.errorMessage).toBe(
      'DuckDB could not return the detailed SQL error. Check the query syntax, table names, and column names.'
    );
  });

  it('returns timeout when the query exceeds the soft timeout', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: () =>
            new Promise(() => {
              /* never resolves */
            }),
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const outcome = await executeQuery('SELECT pg_sleep(60)', { timeoutMs: 50 });
    expect(outcome.status).toBe('timeout');
  });

  it('returns engine-load-failed when the engine factory rejects', async () => {
    __setDuckDbEngineFactoryForTests(() => Promise.reject(new Error('wasm 404')));
    const outcome = await executeQuery('SELECT 1');
    expect(outcome.status).toBe('engine-load-failed');
    expect(outcome.errorMessage).toContain('wasm 404');
  });

  it('returns too-large when the result exceeds MAX_RESULT_ROWS', async () => {
    const oversized = Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, i) => ({ i }));
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        mockEngine(async () =>
          arrowTableFrom([{ name: 'i', type: 'INTEGER' }], oversized)
        )
      )
    );
    const outcome = await executeQuery('SELECT i FROM range(10005)');
    expect(outcome.status).toBe('too-large');
    expect(outcome.tooLarge).toBe(true);
    expect(outcome.rows.length).toBe(MAX_RESULT_ROWS);
  });

  it('returns empty success for whitespace-only input', async () => {
    const outcome = await executeQuery('   \n  ');
    expect(outcome.status).toBe('success');
    expect(outcome.rows).toEqual([]);
    expect(outcome.statementCount).toBe(0);
  });

  it('counts statementCount for multi-statement queries', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        mockEngine(async () =>
          arrowTableFrom([{ name: 'a', type: 'INTEGER' }], [{ a: 1 }])
        )
      )
    );
    const outcome = await executeQuery('SELECT 1; SELECT 2; SELECT 3;');
    expect(outcome.statementCount).toBe(3);
  });
});

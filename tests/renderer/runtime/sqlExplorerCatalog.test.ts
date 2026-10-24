import { describe, expect, it } from 'vitest';
import { loadSqlCatalog } from '../../../src/renderer/runtime/sqlExplorerCatalog';
import type { DuckDbConnection } from '../../../src/renderer/runtime/duckdbClient';

type Row = Record<string, unknown>;

function connection(responses: Array<[RegExp, Row[] | Error]>): DuckDbConnection {
  return {
    query: async (sql: string) => {
      const match = responses.find(([pattern]) => pattern.test(sql));
      if (!match) throw new Error(`unexpected query: ${sql}`);
      if (match[1] instanceof Error) throw match[1];
      return { columns: [], rows: match[1], rowCount: match[1].length, tooLarge: false };
    },
    close: async () => undefined,
  };
}

describe('loadSqlCatalog', () => {
  it('reads tables, views, columns, row counts, macros and information_schema views', async () => {
    const catalog = await loadSqlCatalog(
      connection([
        [
          /information_schema\.tables/,
          [
            { table_schema: 'main', table_name: 'cities', table_type: 'BASE TABLE' },
            { table_schema: 'main', table_name: 'top', table_type: 'VIEW' },
            { table_schema: 'lingua_ledger', table_name: 'runs', table_type: 'BASE TABLE' },
            { table_schema: 'information_schema', table_name: 'columns', table_type: 'VIEW' },
          ],
        ],
        [
          /information_schema\.columns/,
          [
            {
              table_schema: 'main',
              table_name: 'cities',
              column_name: 'city',
              data_type: 'VARCHAR',
            },
            {
              table_schema: 'lingua_ledger',
              table_name: 'runs',
              column_name: 'id',
              data_type: 'UUID',
            },
          ],
        ],
        [/duckdb_tables/, [{ schema_name: 'main', table_name: 'cities', estimated_size: '6' }]],
        [/duckdb_functions/, [{ schema_name: 'main', function_name: 'add_tax' }]],
      ])
    );
    expect(catalog.tables).toEqual([
      {
        name: 'cities',
        sqlName: 'cities',
        kind: 'table',
        columns: [{ name: 'city', type: 'VARCHAR' }],
        rowCount: 6,
      },
      { name: 'top', sqlName: 'top', kind: 'view' },
      {
        name: 'lingua_ledger.runs',
        sqlName: 'runs',
        kind: 'table',
        schemaName: 'lingua_ledger',
        columns: [{ name: 'id', type: 'UUID' }],
      },
    ]);
    expect(catalog.macros).toEqual([{ schemaName: 'main', name: 'add_tax' }]);
    expect(catalog.systemViews).toEqual(['columns']);
  });

  it('keeps the table list when the optional probes fail', async () => {
    const catalog = await loadSqlCatalog(
      connection([
        [
          /information_schema\.tables/,
          [{ table_schema: 'main', table_name: 'cities', table_type: 'BASE TABLE' }],
        ],
        [/information_schema\.columns/, new Error('no columns')],
        [/duckdb_tables/, new Error('no sizes')],
        [/duckdb_functions/, new Error('no macros')],
      ])
    );
    expect(catalog.tables).toEqual([{ name: 'cities', sqlName: 'cities', kind: 'table' }]);
    expect(catalog.macros).toEqual([]);
  });

  it('reads where a Copy to Local filled a table from its comment, and ignores other comments', async () => {
    const catalog = await loadSqlCatalog(
      connection([
        [
          /information_schema\.tables/,
          [
            { table_schema: 'main', table_name: 'orders_copy', table_type: 'BASE TABLE' },
            { table_schema: 'main', table_name: 'notes', table_type: 'BASE TABLE' },
          ],
        ],
        [/information_schema\.columns/, []],
        [
          /duckdb_tables/,
          [
            { schema_name: 'main', table_name: 'orders_copy', estimated_size: '2', comment: '{"kind":"lingua.copy","connection":"orders-dev","at":"2026-10-23T10:00:00.000Z"}' },
            { schema_name: 'main', table_name: 'notes', estimated_size: '1', comment: 'written by hand' },
          ],
        ],
        [/duckdb_functions/, []],
      ])
    );
    expect(catalog.tables).toEqual([
      { name: 'orders_copy', sqlName: 'orders_copy', kind: 'table', rowCount: 2, copiedFrom: { connection: 'orders-dev', at: '2026-10-23T10:00:00.000Z' } },
      { name: 'notes', sqlName: 'notes', kind: 'table', rowCount: 1 },
    ]);
  });
});

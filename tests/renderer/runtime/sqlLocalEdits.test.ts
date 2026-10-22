import { afterEach, describe, expect, it } from 'vitest';
import { __setDuckDbEngineFactoryForTests } from '../../../src/renderer/runtime/duckdbClient';
import { applyLocalEdits, loadLocalEditTable } from '../../../src/renderer/runtime/sqlLocalEdits';

/** A fake engine answering each query by its text; `seen` records every statement. */
function engine(answer: (sql: string) => Array<Record<string, unknown>>, seen: string[] = []) {
  __setDuckDbEngineFactoryForTests(() =>
    Promise.resolve({
      connect: async () => ({
        query: async (sql: string) => {
          seen.push(sql);
          const rows = answer(sql);
          return { columns: [], rows, rowCount: rows.length, tooLarge: false };
        },
        close: async () => undefined,
      }),
      terminate: async () => undefined,
    })
  );
  return seen;
}

afterEach(() => __setDuckDbEngineFactoryForTests(null));

const catalog = (tableType: string, key: unknown) => (sql: string) =>
  sql.includes('information_schema.tables')
    ? [{ table_type: tableType }]
    : sql.includes('information_schema.columns')
      ? [{ column_name: 'id' }, { column_name: 'city' }]
      : sql.includes('PRIMARY KEY') && key !== undefined
        ? [{ constraint_column_names: key }]
        : [];

describe('Local edit targets', () => {
  it('finds rows by the primary key when the table has one, and by rowid when it does not', async () => {
    engine(catalog('BASE TABLE', ['id']));
    expect(await loadLocalEditTable('orders')).toEqual({ engine: 'duckdb', name: 'orders', columns: ['id', 'city'], key: { kind: 'pk', columns: ['id'] } });
    engine(catalog('BASE TABLE', undefined));
    expect(await loadLocalEditTable('sales', 'staging')).toEqual({ engine: 'duckdb', schema: 'staging', name: 'sales', columns: ['id', 'city'], key: { kind: 'rowid' } });
  });

  it('names a view, and offers nothing for a temporary table or a table it cannot read', async () => {
    engine(catalog('VIEW', undefined));
    expect(await loadLocalEditTable('v')).toBe('view');
    engine(catalog('LOCAL TEMPORARY', undefined));
    expect(await loadLocalEditTable('scratch')).toBeNull();
    engine(() => []);
    expect(await loadLocalEditTable('gone')).toBeNull();
  });
});

describe('applying Local edits', () => {
  const table = { engine: 'duckdb' as const, name: 'sales', columns: ['region'], key: { kind: 'rowid' as const } };

  it('runs every change in one transaction and checkpoints nothing extra in memory', async () => {
    const seen = engine((sql) => (sql.startsWith('UPDATE') || sql.startsWith('DELETE') ? [{ Count: 1 }] : []));
    expect(await applyLocalEdits(table, { updates: [{ key: { rowid: '3' }, values: { region: "O'Hare" } }], deletes: [{ key: { rowid: '4' } }], inserts: [] })).toEqual({ applied: 2 });
    expect(seen).toEqual(['BEGIN TRANSACTION', `UPDATE "sales" SET "region" = 'O''Hare' WHERE rowid = '3'`, `DELETE FROM "sales" WHERE rowid = '4'`, 'COMMIT']);
  });

  it('rolls everything back when a change touches no row', async () => {
    const seen = engine((sql) => (sql.startsWith('UPDATE') ? [{ Count: 1 }] : sql.startsWith('DELETE') ? [{ Count: 0 }] : []));
    const result = await applyLocalEdits(table, { updates: [{ key: { rowid: '3' }, values: { region: 'x' } }], deletes: [{ key: { rowid: '9' } }], inserts: [] });
    expect(result).toEqual({ errorMessage: expect.stringMatching(/Change 2 would touch 0 rows/) });
    expect(seen.at(-1)).toBe('ROLLBACK');
    expect(seen).not.toContain('COMMIT');
  });
});

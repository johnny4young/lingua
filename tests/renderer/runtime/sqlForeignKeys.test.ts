import { afterEach, describe, expect, it } from 'vitest';
import { __setDuckDbEngineFactoryForTests } from '../../../src/renderer/runtime/duckdbClient';
import {
  buildLookupSql,
  countReferences,
  loadTableForeignKeys,
  sqlLiteralFor,
} from '../../../src/renderer/runtime/sqlForeignKeys';

function engine(rows: Array<Record<string, unknown>>, seen: string[] = []) {
  __setDuckDbEngineFactoryForTests(() =>
    Promise.resolve({
      connect: async () => ({
        query: async (sql: string) => {
          seen.push(sql);
          return { columns: [], rows, rowCount: rows.length, tooLarge: false };
        },
        close: async () => undefined,
      }),
      terminate: async () => undefined,
    })
  );
}

afterEach(() => __setDuckDbEngineFactoryForTests(null));

describe('loadTableForeignKeys', () => {
  it('splits keys the table declares from keys pointing at it, and skips composite keys', async () => {
    engine([
      { schema_name: 'main', table_name: 'orders', constraint_column_names: ['customer_id'], referenced_table: 'customers', referenced_column_names: ['id'] },
      { schema_name: 'main', table_name: 'order_items', constraint_column_names: '["order_id"]', referenced_table: 'orders', referenced_column_names: '["id"]' },
      { schema_name: 'main', table_name: 'orders', constraint_column_names: ['a', 'b'], referenced_table: 'pairs', referenced_column_names: ['a', 'b'] },
    ]);
    const keys = await loadTableForeignKeys('orders');
    expect(keys.outgoing).toEqual([{ table: 'orders', schema: 'main', column: 'customer_id', refTable: 'customers', refColumn: 'id' }]);
    expect(keys.incoming).toEqual([{ table: 'order_items', schema: 'main', column: 'order_id', refTable: 'orders', refColumn: 'id' }]);
  });

  it('quotes the table name it looks up', async () => {
    const seen: string[] = [];
    engine([], seen);
    await loadTableForeignKeys("o'rders");
    expect(seen.at(-1)).toContain("table_name = 'o''rders'");
  });
});

describe('lookups', () => {
  it('builds the SELECT a link opens, quoting names and values', () => {
    expect(buildLookupSql('customers', 'main', 'id', 7781)).toBe('SELECT * FROM "customers" WHERE "id" = 7781 LIMIT 100;');
    expect(buildLookupSql('c', 'sales', 'code', "it's")).toBe(`SELECT * FROM "sales"."c" WHERE "code" = 'it''s' LIMIT 100;`);
    expect(sqlLiteralFor(true)).toBe('TRUE');
  });

  it('counts referencing rows, or null when the count fails', async () => {
    engine([{ n: '3' }]);
    expect(await countReferences({ table: 'order_items', schema: 'main', column: 'order_id', refTable: 'orders', refColumn: 'id' }, 10402)).toBe(3);
    engine([{}]);
    expect(await countReferences({ table: 't', schema: 'main', column: 'c', refTable: 'x', refColumn: 'id' }, 1)).toBeNull();
  });
});

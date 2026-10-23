import { describe, expect, it } from 'vitest';
import { ROW_EDIT_ENGINES, rowEditProblem, rowEditReview, rowEditStatements, type RowEditChanges, type RowEditTable } from '../../src/shared/sqlRowEdits';

const orders: RowEditTable = { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city', 'total', 'created_at'], key: { kind: 'pk', columns: ['id'] } };

const changes: RowEditChanges = {
  updates: [
    { key: { id: '10401' }, values: { total: '3450.00' } },
    { key: { id: '10403' }, values: { city: "Santiago de Cali's", total: null } },
  ],
  deletes: [{ key: { id: '10404' } }],
  inserts: [{ values: { city: 'Envigado', total: '1' } }, { values: {} }],
};

describe('staged row edits', () => {
  it('binds every value on Postgres, finding rows by their whole key', () => {
    expect(rowEditStatements(orders, changes, false)).toEqual([
      { sql: 'UPDATE "public"."orders" SET "total" = $1 WHERE "id" = $2', params: ['3450.00', '10401'] },
      { sql: 'UPDATE "public"."orders" SET "city" = $1, "total" = $2 WHERE "id" = $3', params: ["Santiago de Cali's", null, '10403'] },
      { sql: 'DELETE FROM "public"."orders" WHERE "id" = $1', params: ['10404'] },
      { sql: 'INSERT INTO "public"."orders" ("city", "total") VALUES ($1, $2)', params: ['Envigado', '1'] },
      { sql: 'INSERT INTO "public"."orders" DEFAULT VALUES', params: [] },
    ]);
  });

  it('uses ? and backticks on MySQL, and an empty insert MySQL accepts', () => {
    const billing: RowEditTable = { engine: 'mysql', name: 'invoices', columns: ['tenant', 'number', 'paid'], key: { kind: 'pk', columns: ['tenant', 'number'] } };
    expect(
      rowEditStatements(billing, { updates: [{ key: { tenant: 't1', number: '7' }, values: { paid: '1' } }], deletes: [], inserts: [{ values: {} }] }, false)
    ).toEqual([
      { sql: 'UPDATE `invoices` SET `paid` = ? WHERE `tenant` = ? AND `number` = ?', params: ['1', 't1', '7'] },
      { sql: 'INSERT INTO `invoices` () VALUES ()', params: [] },
    ]);
  });

  it('binds @p1, @p2… and brackets on SQL Server, and edits only engines with row-by-row transactions', () => {
    const erp: RowEditTable = { engine: 'sqlserver', schema: 'dbo', name: 'orders', columns: ['id', 'city'], key: { kind: 'pk', columns: ['id'] } };
    expect(rowEditStatements(erp, { updates: [{ key: { id: '1' }, values: { city: 'Cali' } }], deletes: [{ key: { id: '2' } }], inserts: [] }, false)).toEqual([
      { sql: 'UPDATE [dbo].[orders] SET [city] = @p1 WHERE [id] = @p2', params: ['Cali', '1'] },
      { sql: 'DELETE FROM [dbo].[orders] WHERE [id] = @p1', params: ['2'] },
    ]);
    expect(rowEditReview(erp, { updates: [{ key: { id: '1' }, values: { city: "O'Brien" } }], deletes: [], inserts: [] })).toContain("SET [city] = N'O''Brien'");
    expect([...ROW_EDIT_ENGINES].sort()).toEqual(['duckdb', 'libsql', 'mysql', 'neon', 'postgres', 'sqlite', 'sqlserver']);
  });

  it('binds $n on Neon and ? on libSQL, and leaves D1 and ClickHouse without staged edits', () => {
    const neon: RowEditTable = { engine: 'neon', schema: 'public', name: 'users', columns: ['id', 'name'], key: { kind: 'pk', columns: ['id'] } };
    expect(rowEditStatements(neon, { updates: [{ key: { id: '1' }, values: { name: 'Ana' } }], deletes: [], inserts: [] }, false)).toEqual([
      { sql: 'UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2', params: ['Ana', '1'] },
    ]);
    const turso: RowEditTable = { ...neon, engine: 'libsql', schema: 'main' };
    expect(rowEditStatements(turso, { updates: [], deletes: [{ key: { id: '2' } }], inserts: [] }, false)).toEqual([{ sql: 'DELETE FROM "main"."users" WHERE "id" = ?', params: ['2'] }]);
    expect(ROW_EDIT_ENGINES.has('d1')).toBe(false);
    expect(ROW_EDIT_ENGINES.has('clickhouse')).toBe(false);
  });

  it('writes literals for DuckDB and finds a keyless Local row by rowid', () => {
    const local: RowEditTable = { engine: 'duckdb', name: 'sales', columns: ['region', 'amount'], key: { kind: 'rowid' } };
    expect(rowEditStatements(local, { updates: [{ key: { rowid: '3' }, values: { region: "O'Hare" } }], deletes: [{ key: { rowid: '4' } }], inserts: [] }, true)).toEqual([
      { sql: `UPDATE "sales" SET "region" = 'O''Hare' WHERE rowid = '3'`, params: [] },
      { sql: `DELETE FROM "sales" WHERE rowid = '4'`, params: [] },
    ]);
  });

  it('shows one transaction with the values written in', () => {
    expect(rowEditReview(orders, { updates: [changes.updates[0]!], deletes: changes.deletes, inserts: [] })).toBe(
      ['BEGIN;', `UPDATE "public"."orders" SET "total" = '3450.00' WHERE "id" = '10401';`, `DELETE FROM "public"."orders" WHERE "id" = '10404';`, 'COMMIT;'].join('\n')
    );
  });

  it('quotes names an attacker could choose, so they stay names', () => {
    const odd: RowEditTable = { engine: 'mysql', name: 'a`; DROP TABLE x; --', columns: ["c'`"], key: { kind: 'pk', columns: ["c'`"] } };
    const [update] = rowEditStatements(odd, { updates: [{ key: { "c'`": "1'; --" }, values: { "c'`": '\\' } }], deletes: [], inserts: [] }, true);
    expect(update!.sql).toBe("UPDATE `a``; DROP TABLE x; --` SET `c'``` = '\\\\' WHERE `c'``` = '1''; --'");
  });

  it('refuses empty sets, unknown columns, partial keys, bad values and too many rows', () => {
    const none = { updates: [], deletes: [], inserts: [] };
    expect(rowEditProblem(orders, changes)).toBeNull();
    expect(rowEditProblem(orders, none)).toBe('empty');
    expect(rowEditProblem(orders, { ...none, updates: [{ key: { id: '1' }, values: { secret: 'x' } }] })).toBe('unknown-column');
    expect(rowEditProblem(orders, { ...none, updates: [{ key: { id: '1' }, values: {} }] })).toBe('invalid-value');
    expect(rowEditProblem(orders, { ...none, deletes: [{ key: {} }] })).toBe('missing-key');
    expect(rowEditProblem(orders, { ...none, deletes: [{ key: { id: null } }] })).toBe('missing-key');
    expect(rowEditProblem(orders, { ...none, deletes: [{ key: { id: '1', city: 'x' } }] })).toBe('missing-key');
    expect(rowEditProblem(orders, { ...none, inserts: [{ values: { city: 'x'.repeat(1024 * 1024 + 1) } }] })).toBe('invalid-value');
    expect(rowEditProblem(orders, { ...none, deletes: Array.from({ length: 1001 }, (_, i) => ({ key: { id: String(i) } })) })).toBe('too-many');
  });
});

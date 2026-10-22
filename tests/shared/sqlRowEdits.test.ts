import { describe, expect, it } from 'vitest';
import { rowEditProblem, rowEditReview, rowEditStatements, type RowEditChanges, type RowEditTable } from '../../src/shared/sqlRowEdits';

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

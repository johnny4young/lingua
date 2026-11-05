import { describe, expect, it } from 'vitest';
import { cellTextIsExact, parseRowEditChanges, ROW_EDIT_ENGINES, rowEditProblem, rowEditRefusal, rowEditReview, rowEditStatements, rowEditTableFrom, type RowEditChanges, type RowEditTable } from '../../src/shared/sqlRowEdits';

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

describe('column types in staged edits', () => {
  const typed: RowEditTable = {
    engine: 'postgres',
    schema: 'public',
    name: 'files',
    columns: ['id', 'city', 'n', 'body', 'at', 'score', 'meta'],
    types: { id: 'integer', city: 'character varying(40)', n: 'bigint', body: 'bytea', at: 'timestamp without time zone', score: 'double precision', meta: 'jsonb' },
    key: { kind: 'pk', columns: ['id'] },
  };

  it('checks the original values it can compare, NULL included, and binds them in order', () => {
    expect(
      rowEditStatements(typed, { updates: [{ key: { id: '1' }, values: { city: 'mine' }, original: { city: 'theirs', n: null, at: '2026-01-01', score: '0.1', meta: '{}', id: '1' } }], deletes: [{ key: { id: '2' }, original: { city: 'x' } }], inserts: [] }, false)
    ).toEqual([
      { sql: 'UPDATE "public"."files" SET "city" = $1 WHERE "id" = $2 AND "city" = $3 AND "n" IS NULL', params: ['mine', '1', 'theirs'] },
      { sql: 'DELETE FROM "public"."files" WHERE "id" = $1 AND "city" = $2', params: ['2', 'x'] },
    ]);
  });

  it('binds MySQL\'s positional parameters left to right', () => {
    const billing: RowEditTable = { engine: 'mysql', name: 't', columns: ['id', 'city'], types: { id: 'int', city: 'varchar(40)' }, key: { kind: 'pk', columns: ['id'] } };
    expect(rowEditStatements(billing, { updates: [{ key: { id: '1' }, values: { city: 'mine' }, original: { city: 'theirs' } }], deletes: [], inserts: [] }, false)).toEqual([
      { sql: 'UPDATE `t` SET `city` = ? WHERE `id` = ? AND `city` = ?', params: ['mine', '1', 'theirs'] },
    ]);
  });

  it('never compares SQL Server decimals or its legacy text types', () => {
    const erp: RowEditTable = { engine: 'sqlserver', schema: 'dbo', name: 't', columns: ['id', 'price', 'notes', 'city'], types: { id: 'int', price: 'decimal(10,2)', notes: 'ntext', city: 'nvarchar(40)' }, key: { kind: 'pk', columns: ['id'] } };
    expect(rowEditStatements(erp, { updates: [{ key: { id: '1' }, values: { city: 'a' }, original: { price: '1.10', notes: 'n', city: 'b' } }], deletes: [], inserts: [] }, false)[0]?.sql).toBe('UPDATE [dbo].[t] SET [city] = @p1 WHERE [id] = @p2 AND [city] = @p3');
  });

  it('refuses text for a binary column, and an empty value for a number or a date, but takes NULL', () => {
    const update = (values: Record<string, string | null>): RowEditChanges => ({ updates: [{ key: { id: '1' }, values }], deletes: [], inserts: [] });
    expect(rowEditProblem(typed, update({ body: 'AP8Q' }))).toBe('invalid-value');
    expect(rowEditProblem(typed, update({ body: null }))).toBeNull();
    expect(rowEditProblem(typed, update({ n: '' }))).toBe('invalid-value');
    expect(rowEditProblem(typed, update({ at: '' }))).toBe('invalid-value');
    expect(rowEditProblem(typed, update({ city: '' }))).toBeNull();
    expect(rowEditProblem(typed, { updates: [], deletes: [], inserts: [{ values: { body: 'AP8Q' } }] })).toBe('invalid-value');
    expect(rowEditProblem(typed, { updates: [{ key: { id: '1' }, values: { city: 'a' }, original: { gone: 'x' } }], deletes: [], inserts: [] })).toBe('unknown-column');
    expect(rowEditProblem(typed, { updates: [], deletes: [{ key: { id: '1' }, original: { gone: 'x' } }], inserts: [] })).toBe('unknown-column');
  });

  it.each([
    ['sqlserver', 'decimal(20,0)', 'key-type'],
    ['sqlserver', 'datetime2', 'key-type'],
    ['sqlserver', 'money', 'key-type'],
    ['postgres', 'timestamp without time zone', 'key-type'],
    ['postgres', 'date', 'key-type'],
    ['postgres', 'bytea', 'key-type'],
    ['mysql', 'bit(8)', 'key-type'],
    ['postgres', 'double precision', 'key-type'],
    ['duckdb', 'TIMESTAMP', 'key-type'],
    ['postgres', 'numeric(20,0)', null],
    ['mysql', 'datetime(6)', null],
    ['sqlite', 'DATETIME', null],
    ['sqlserver', 'bigint', null],
    ['postgres', 'uuid', null],
    ['postgres', 'inet', null],
  ] as const)('reads a %s key of type %s as %s', (engine, type, expected) => {
    expect(rowEditRefusal(engine, [{ name: 'k', primaryKey: true, type }])).toBe(expected);
    expect(rowEditTableFrom(engine, 's', 't', [{ name: 'k', primaryKey: true, type }]) === null).toBe(expected !== null);
  });

  it('says first that a table has no key, then that it has no transactions', () => {
    expect(rowEditRefusal('mysql', [{ name: 'k', type: 'int' }], false)).toBe('no-key');
    expect(rowEditRefusal('mysql', [{ name: 'k', primaryKey: true, type: 'int' }], false)).toBe('no-transactions');
    expect(rowEditTableFrom('mysql', 's', 't', [{ name: 'k', primaryKey: true, type: 'int' }], false)).toBeNull();
    expect(cellTextIsExact({ engine: 'mysql' }, 'unknown')).toBe(true);
  });

  it('keeps originals over IPC, leaves them out when empty, and refuses a bad one', () => {
    expect(parseRowEditChanges({ updates: [{ key: { id: '1' }, values: { v: 'a' }, original: { v: 'b' } }], deletes: [{ key: { id: '2' }, original: { v: null } }], inserts: [] })).toEqual({
      updates: [{ key: { id: '1' }, values: { v: 'a' }, original: { v: 'b' } }],
      deletes: [{ key: { id: '2' }, original: { v: null } }],
      inserts: [],
    });
    expect(parseRowEditChanges({ updates: [{ key: { id: '1' }, values: { v: 'a' } }], deletes: [], inserts: [] })?.updates[0]).toEqual({ key: { id: '1' }, values: { v: 'a' } });
    expect(parseRowEditChanges({ updates: [{ key: { id: '1' }, values: {}, original: { v: 7 } }], deletes: [], inserts: [] })).toBeNull();
  });
});

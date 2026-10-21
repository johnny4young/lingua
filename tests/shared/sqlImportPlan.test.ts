import { describe, expect, it } from 'vitest';
import {
  buildImportStatements,
  defaultMapping,
  mappingProblem,
  readerSql,
} from '../../src/shared/sqlImportPlan';

const existing = {
  mode: 'existing' as const,
  table: 'orders',
  columns: [
    { name: 'city', type: 'VARCHAR' },
    { name: 'total', type: 'DECIMAL(12,2)' },
    { name: 'created_at', type: 'TIMESTAMP' },
  ],
};

describe('readerSql', () => {
  it('passes the CSV header and delimiter, quoting the file name', () => {
    expect(readerSql('csv', "it's.csv", { header: false, delimiter: ';' })).toBe(
      "read_csv('it''s.csv', header = false, delim = ';', auto_detect = true)"
    );
    expect(readerSql('parquet', 'x.parquet')).toBe("read_parquet('x.parquet')");
  });
});

describe('defaultMapping', () => {
  it('keeps every column for a new table and matches names for an existing one', () => {
    expect(defaultMapping(['a', 'b'], { mode: 'new', table: 't' })).toEqual([
      { source: 'a', target: 'a' },
      { source: 'b', target: 'b' },
    ]);
    expect(defaultMapping(['City', 'total_cop', 'notes'], existing)).toEqual([
      { source: 'City', target: 'city' },
      { source: 'total_cop', target: null },
      { source: 'notes', target: null },
    ]);
  });
});

describe('mappingProblem', () => {
  it('needs one mapped column, no blank names and no duplicates', () => {
    expect(mappingProblem([{ source: 'a', target: null }])).toBe('nothing-mapped');
    expect(mappingProblem([{ source: 'a', target: ' ' }])).toBe('empty-target');
    expect(mappingProblem([{ source: 'a', target: 'x' }, { source: 'b', target: 'X' }])).toBe('duplicate-target');
    expect(mappingProblem([{ source: 'a', target: 'x' }])).toBeNull();
  });
});

describe('buildImportStatements', () => {
  it('creates a new table with SELECT * when nothing is renamed or skipped', () => {
    expect(
      buildImportStatements({ format: 'json', file: 'f.json', target: { mode: 'new', table: 'people' }, mapping: [{ source: 'a', target: 'a' }] })
    ).toEqual([`CREATE TABLE "people" AS SELECT * FROM read_json_auto('f.json')`]);
  });

  it('renames and skips columns of a new table', () => {
    expect(
      buildImportStatements({
        format: 'csv',
        file: 'f.csv',
        target: { mode: 'new', table: 'sales' },
        mapping: [
          { source: 'fecha', target: 'created_at' },
          { source: 'notes', target: null },
        ],
      })[0]
    ).toBe(`CREATE TABLE "sales" AS SELECT "fecha" AS "created_at" FROM read_csv('f.csv', header = true, delim = ',', auto_detect = true)`);
  });

  it('inserts into an existing table in one transaction, cast to each column type', () => {
    expect(
      buildImportStatements({
        format: 'csv',
        file: 'f.csv',
        csv: { header: true, delimiter: ';' },
        target: { ...existing, schema: 'shop' },
        mapping: [
          { source: 'city', target: 'city' },
          { source: 'total_cop', target: 'total' },
          { source: 'fecha', target: 'created_at' },
          { source: 'notes', target: null },
        ],
      })
    ).toEqual([
      'BEGIN TRANSACTION',
      `INSERT INTO "shop"."orders" ("city", "total", "created_at") SELECT CAST("city" AS VARCHAR), CAST("total_cop" AS DECIMAL(12,2)), CAST("fecha" AS TIMESTAMP) FROM read_csv('f.csv', header = true, delim = ';', auto_detect = true)`,
      'COMMIT',
    ]);
  });

  it('inserts without a cast when a column type is not plain type syntax', () => {
    const [, insert] = buildImportStatements({
      format: 'csv',
      file: 'f.csv',
      target: { mode: 'existing', table: 't', columns: [{ name: 'mood', type: "x'); DROP TABLE t; --" }] },
      mapping: [{ source: 'mood', target: 'mood' }],
    });
    expect(insert).toContain('SELECT "mood" FROM');
  });

  it('inserts without a cast when a type would close the CAST early', () => {
    const [, insert] = buildImportStatements({
      format: 'csv',
      file: 'f.csv',
      target: {
        mode: 'existing',
        table: 't',
        columns: [
          { name: 'a', type: 'INTEGER) AS x FROM other UNION ALL SELECT CAST(1 AS INTEGER' },
          { name: 'b', type: 'STRUCT(v INTEGER, w DECIMAL(18,3))' },
        ],
      },
      mapping: [
        { source: 'a', target: 'a' },
        { source: 'b', target: 'b' },
      ],
    });
    expect(insert).toContain('SELECT "a", CAST("b" AS STRUCT(v INTEGER, w DECIMAL(18,3))) FROM');
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyConditions,
  buildGridSql,
  fixedRowWindow,
  visibleColumns,
  type SqlFilterCondition,
} from '../../../src/renderer/components/SqlWorkspace/sqlResultFilters';

const columns = [
  { name: 'id', type: 'Int64' },
  { name: 'city', type: 'Utf8' },
  { name: 'total', type: 'Float64' },
];
const rows = [
  { id: '1', city: 'Medellin', total: 3410 },
  { id: '2', city: 'Cali', total: 88 },
  { id: '3', city: 'Medellin', total: 77.9 },
  { id: '4', city: null, total: 230 },
];
const cond = (column: string, op: SqlFilterCondition['op'], value = ''): SqlFilterCondition => ({
  id: `${column}${op}${value}`,
  column,
  op,
  value,
});

describe('applyConditions', () => {
  it('ANDs conditions and compares numeric columns as numbers', () => {
    const out = applyConditions(rows, [cond('city', '=', 'Medellin'), cond('total', '>', '100')], columns);
    expect(out.map((row) => row.id)).toEqual(['1']);
    // BIGINT arrives as a string but still compares numerically.
    expect(applyConditions(rows, [cond('id', '>=', '3')], columns).map((row) => row.id)).toEqual(['3', '4']);
  });

  it('handles null tests, exclusions and contains', () => {
    expect(applyConditions(rows, [cond('city', 'is-null')], columns).map((row) => row.id)).toEqual(['4']);
    expect(applyConditions(rows, [cond('city', '!=', 'Medellin')], columns).map((row) => row.id)).toEqual(['2']);
    expect(applyConditions(rows, [cond('city', 'contains', 'MED')], columns)).toHaveLength(2);
  });

  it('ignores conditions on a column the result no longer has', () => {
    expect(applyConditions(rows, [cond('gone', '=', 'x')], columns)).toHaveLength(4);
  });
});

describe('visibleColumns', () => {
  it('follows the layout order, appends new columns and drops hidden ones', () => {
    expect(visibleColumns(columns, { order: ['total', 'id'], hidden: ['id'] }).map((c) => c.name)).toEqual(['total', 'city']);
  });
});

describe('buildGridSql', () => {
  const layout = { order: [], hidden: [] };

  it('returns null when the grid adds nothing', () => {
    expect(buildGridSql('SELECT * FROM t', [], { column: null, direction: 'asc' }, columns, layout)).toBeNull();
  });

  it('wraps the query with filters, sort and the shown columns', () => {
    const sql = buildGridSql(
      'SELECT * FROM orders;',
      [cond('city', '=', "O'Hare"), cond('total', '>', '100'), cond('city', 'contains', '50%')],
      { column: 'total', direction: 'desc' },
      columns,
      { order: [], hidden: ['id'] }
    );
    expect(sql).toBe(
      [
        'SELECT "city", "total"',
        'FROM (',
        'SELECT * FROM orders',
        ') AS result',
        `WHERE "city" = 'O''Hare'`,
        '  AND "total" > 100',
        `  AND CAST("city" AS VARCHAR) ILIKE '%50\\%%' ESCAPE '\\'`,
        'ORDER BY "total" DESC',
      ].join('\n')
    );
  });
});

describe('buildGridSql with comments', () => {
  it('drops a comment after the semicolon so it cannot swallow the closing parenthesis', () => {
    const sql = buildGridSql('SELECT * FROM orders -- recent\n; -- trailing', [], { column: 'total', direction: 'asc' }, columns, {
      order: [],
      hidden: [],
    });
    expect(sql).toBe('SELECT *\nFROM (\nSELECT * FROM orders -- recent\n) AS result\nORDER BY "total" ASC');
  });
});

describe('fixedRowWindow', () => {
  it('mounts the visible rows plus overscan and pads the rest', () => {
    expect(fixedRowWindow({ count: 100_000, rowHeight: 26, scrollTop: 26 * 500, viewportHeight: 260, overscan: 5 })).toEqual({
      start: 495,
      end: 515,
      top: 495 * 26,
      bottom: (100_000 - 1 - 515) * 26,
    });
  });

  it('handles an empty list and an unmeasured viewport', () => {
    expect(fixedRowWindow({ count: 0, rowHeight: 26, scrollTop: 0, viewportHeight: 0, overscan: 5 }).end).toBe(-1);
    expect(fixedRowWindow({ count: 1_000, rowHeight: 26, scrollTop: 0, viewportHeight: 0, overscan: 5 }).end).toBe(45);
  });
});

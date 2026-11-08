import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cellMagic, fractionColumns } from '../../../src/renderer/components/SqlWorkspace/sqlCellMagic';
import { viewCell } from '../../../src/renderer/components/SqlWorkspace/sqlCellValue';
import { betweenPredicate, columnStats } from '../../../src/renderer/components/SqlWorkspace/sqlColumnStats';
import { compareNumbers, nonFiniteNumber, quoteNonFiniteJson } from '../../../src/renderer/components/SqlWorkspace/sqlNonFinite';
import { DEFAULT_EXPORT_OPTIONS, rowsToPythonSource, rowsToSqlInsert, serializeRows } from '../../../src/renderer/components/SqlWorkspace/sqlResultExport';
import { applyConditions, buildGridSql, type SqlFilterCondition } from '../../../src/renderer/components/SqlWorkspace/sqlResultFilters';
import { renderCell } from '../../../src/renderer/components/SqlWorkspace/sqlResultFormatters';
import { filterRows, sortRows } from '../../../src/renderer/components/SqlWorkspace/sqlResultGrid';
import { canEditCell, changeSet, cellText, NO_EDITS, stageCell } from '../../../src/renderer/components/SqlWorkspace/sqlRowEditModel';
import { rowsToXlsx } from '../../../src/renderer/components/SqlWorkspace/sqlXlsx';
import type { RowEditTable } from '../../../src/shared/sqlRowEdits';

const columns = [{ name: 'x', type: 'Float64' }];
// In the order DuckDB sorts them: NaN above Infinity, NULL last.
const ORDERED = ['-Infinity', -5, 1.5, 'Infinity', 'NaN', null];
const rows = [1.5, 'NaN', null, '-Infinity', 'Infinity', -5].map((x) => ({ x }));
const column = (cells: ReadonlyArray<Record<string, unknown>>) => cells.map((row) => row.x);

describe('nonFiniteNumber', () => {
  it('reads only the exact text of a non-finite number', () => {
    expect(nonFiniteNumber('Infinity')).toBe(Number.POSITIVE_INFINITY);
    expect(nonFiniteNumber('-Infinity')).toBe(Number.NEGATIVE_INFINITY);
    expect(nonFiniteNumber('NaN')).toBeNaN();
    for (const other of ['infinity', 'nan', '+Infinity', ' NaN', 'constructor', '', 5, null, undefined]) {
      expect(nonFiniteNumber(other)).toBeNull();
    }
  });
});

describe('compareNumbers', () => {
  it('orders NaN above Infinity and equal to itself', () => {
    expect(compareNumbers(Number.NaN, Number.POSITIVE_INFINITY)).toBe(1);
    expect(compareNumbers(Number.POSITIVE_INFINITY, Number.NaN)).toBe(-1);
    expect(compareNumbers(Number.NaN, Number.NaN)).toBe(0);
    expect(compareNumbers(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
    expect(compareNumbers(Number.NEGATIVE_INFINITY, -1e308)).toBe(-1);
    expect(compareNumbers(2, 1)).toBe(1);
  });
});

describe('quoteNonFiniteJson', () => {
  const quote = (text: string) => new TextDecoder().decode(quoteNonFiniteJson(new TextEncoder().encode(text)));

  it('quotes what DuckDB writes bare so the file parses', () => {
    const array = '[\n\t{"x":Infinity},\n\t{"x":-Infinity},\n\t{"x":NaN},\n\t{"x":1.5},\n\t{"x":null}\n]\n';
    expect(JSON.parse(quote(array))).toEqual([{ x: 'Infinity' }, { x: '-Infinity' }, { x: 'NaN' }, { x: 1.5 }, { x: null }]);
    expect(quote('{"x":NaN}\n{"x":-Infinity}\n')).toBe('{"x":"NaN"}\n{"x":"-Infinity"}\n');
  });

  it('reaches nested values and leaves strings, keys and other numbers alone', () => {
    const line = '{"NaN":"Infinity","say \\"NaN\\"":"a\\\\","año":"-Infinity é","list":[NaN,-1E+5,2e-3,true],"s":{"y":Infinity}}';
    expect(JSON.parse(quote(line))).toEqual({ NaN: 'Infinity', 'say "NaN"': 'a\\', año: '-Infinity é', list: ['NaN', -1e5, 2e-3, true], s: { y: 'Infinity' } });
  });

  it('returns the same bytes when there is nothing to quote', () => {
    const bytes = new TextEncoder().encode('[{"x":1,"y":"NaN"}]');
    expect(quoteNonFiniteJson(bytes)).toBe(bytes);
  });
});

describe('column stats', () => {
  const [stats] = columnStats(columns, rows);

  it('counts only real NULLs as null and each non-finite value as distinct', () => {
    expect(stats!.nullShare).toBeCloseTo(1 / 6);
    expect(stats!.distinct).toBe(5);
  });

  it('names non-finite values in the range and keeps them out of the bins', () => {
    expect(stats!.range).toEqual({ low: '-Infinity', high: 'NaN' });
    expect(stats!.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
    for (const bin of stats!.bins) {
      expect(Number.isFinite(bin.low) && Number.isFinite(bin.high)).toBe(true);
    }
    expect(betweenPredicate(stats!, stats!.bins[0]!, stats!.bins.at(-1)!)).toBe('x BETWEEN -5 AND 1.5');
  });

  it('gives a column of only non-finite values a range and no bins', () => {
    const [only] = columnStats(columns, [{ x: 'Infinity' }, { x: 'Infinity' }]);
    expect(only).toMatchObject({ nullShare: 0, distinct: 1, range: { low: 'Infinity', high: 'Infinity' }, bins: [] });
    const [mixed] = columnStats(columns, [{ x: 'NaN' }, { x: '-Infinity' }]);
    expect(mixed!.range).toEqual({ low: '-Infinity', high: 'NaN' });
  });

  it.each([
    [['NaN'], 'NaN', 'NaN'],
    [['-Infinity'], '-Infinity', '-Infinity'],
    [['Infinity', 'NaN'], 'Infinity', 'NaN'],
    [[1.5, 'NaN'], '1.5', 'NaN'],
    [['NaN', 1.5], '1.5', 'NaN'],
    [[1.5, 'Infinity'], '1.5', 'Infinity'],
    [['-Infinity', 1.5], '-Infinity', '1.5'],
  ])('ranges %j from %s to %s, in any row order', (cells, low, high) => {
    expect(columnStats(columns, cells.map((x) => ({ x })))[0]!.range).toEqual({ low, high });
  });

  it('still reports no range for a column of NULLs', () => {
    expect(columnStats(columns, [{ x: null }])[0]!.range).toBeNull();
  });

  it('treats those words as text in a text column', () => {
    const [text] = columnStats([{ name: 'x', type: 'Utf8' }], [{ x: 'Infinity' }, { x: 'NaN' }]);
    expect(text).toMatchObject({ kind: 'text', range: { low: 'Infinity', high: 'NaN' }, bins: [] });
    expect(text!.top).toHaveLength(2);
  });
});

describe('grid sort and search', () => {
  it('sorts non-finite cells in their numeric place, with NULL last', () => {
    expect(column(sortRows(rows, { column: 'x', direction: 'asc' }))).toEqual(ORDERED);
  });

  it('reverses the same order for descending', () => {
    expect(column(sortRows(rows, { column: 'x', direction: 'desc' }))).toEqual([...ORDERED].reverse());
  });

  it('keeps a text column in text order', () => {
    const words = ['NaN', 'apple', 'Infinity', 'zebra'].map((x) => ({ x }));
    expect(column(sortRows(words, { column: 'x', direction: 'asc' }))).toEqual(['apple', 'Infinity', 'NaN', 'zebra']);
  });

  it('finds them by their text, and null only finds real NULLs', () => {
    expect(column(filterRows(rows, 'inf'))).toEqual(['-Infinity', 'Infinity']);
    expect(column(filterRows(rows, 'nan'))).toEqual(['NaN']);
    expect(column(filterRows(rows, 'null'))).toEqual([null]);
  });
});

describe('grid filter conditions', () => {
  const run = (op: SqlFilterCondition['op'], value = '') => column(applyConditions(rows, [{ id: 'c', column: 'x', op, value }], columns));

  it('compares as DuckDB does', () => {
    expect(run('>', '100')).toEqual(['NaN', 'Infinity']);
    expect(run('<', '-100')).toEqual(['-Infinity']);
    expect(run('>=', 'Infinity')).toEqual(['NaN', 'Infinity']);
    expect(run('<=', '-Infinity')).toEqual(['-Infinity']);
  });

  it('matches equality on the value itself', () => {
    expect(run('=', 'Infinity')).toEqual(['Infinity']);
    expect(run('=', '-Infinity')).toEqual(['-Infinity']);
    expect(run('=', 'NaN')).toEqual(['NaN']);
    expect(run('!=', 'NaN')).toEqual([1.5, '-Infinity', 'Infinity', -5]);
  });

  it('does not count them as NULL', () => {
    expect(run('is-null')).toEqual([null]);
    expect(run('not-null')).toEqual([1.5, 'NaN', '-Infinity', 'Infinity', -5]);
  });

  it('finds them with contains', () => {
    expect(run('contains', 'infin')).toEqual(['-Infinity', 'Infinity']);
  });

  it('writes a typed value as a literal DuckDB casts', () => {
    const conditions: SqlFilterCondition[] = [{ id: 'c', column: 'x', op: '=', value: 'Infinity' }];
    expect(buildGridSql('SELECT 1', conditions, { column: null, direction: 'asc' }, columns, { order: ['x'], hidden: [] })).toContain(`"x" = 'Infinity'`);
  });
});

describe('exports of loaded rows', () => {
  const values = [{ x: 'Infinity' }, { x: '-Infinity' }, { x: 'NaN' }, { x: null }];

  it('writes the text in CSV, TSV and Markdown, and an empty cell only for NULL', () => {
    expect(serializeRows('csv', columns, values, DEFAULT_EXPORT_OPTIONS)).toBe('x\nInfinity\n-Infinity\nNaN\n');
    expect(serializeRows('tsv', columns, values, DEFAULT_EXPORT_OPTIONS)).toBe('x\nInfinity\n-Infinity\nNaN\n');
    expect(serializeRows('markdown', columns, values, DEFAULT_EXPORT_OPTIONS)).toContain('| Infinity |\n| -Infinity |\n| NaN |\n|  |');
  });

  it('writes valid JSON and NDJSON', () => {
    expect(JSON.parse(serializeRows('json', columns, values, DEFAULT_EXPORT_OPTIONS))).toEqual(values);
    const lines = serializeRows('ndjson', columns, values, DEFAULT_EXPORT_OPTIONS).split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual(values);
  });

  it('writes SQL INSERT values DuckDB casts', () => {
    expect(rowsToSqlInsert(columns, values, 't')).toBe(`INSERT INTO "t" ("x") VALUES\n  ('Infinity'),\n  ('-Infinity'),\n  ('NaN'),\n  (NULL);`);
  });

  it('hands Python real floats on a numeric column and strings on a text one', () => {
    const { source } = rowsToPythonSource(columns, values, () => '#');
    expect(source).toContain('{"x": float("Infinity")}');
    expect(source).toContain('{"x": float("-Infinity")}');
    expect(source).toContain('{"x": float("NaN")}');
    expect(source).toContain('{"x": None}');
    expect(rowsToPythonSource([{ name: 'x', type: 'Utf8' }], [{ x: 'NaN' }], () => '#').source).toContain('{"x": "NaN"}');
  });

  it('writes text cells in XLSX, which has no such numbers, and a blank only for NULL', () => {
    const xml = strFromU8(unzipSync(rowsToXlsx(columns, values))['xl/worksheets/sheet1.xml']!);
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Infinity</t></is></c>');
    expect(xml).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">-Infinity</t></is></c>');
    expect(xml).toContain('<c r="A4" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>');
    expect(xml).toContain('<row r="5"></row>');
  });
});

describe('row editor', () => {
  const table: RowEditTable = { engine: 'duckdb', schema: 'main', name: 'readings', columns: ['id', 'x'], key: { kind: 'pk', columns: ['id'] } };

  it('starts an edit from the text and takes a change back to it as no change', () => {
    const row = { id: 1, x: 'Infinity' };
    expect(cellText(row.x)).toBe('Infinity');
    const edited = stageCell(NO_EDITS, table, row, 'x', '2');
    expect(changeSet(edited).updates).toEqual([{ key: { id: '1' }, values: { x: '2' } }]);
    expect(changeSet(stageCell(edited, table, row, 'x', 'Infinity')).updates).toEqual([]);
  });

  it('finds a row whose key is non-finite instead of calling it NULL', () => {
    const row = { id: 'NaN', x: 1 };
    expect(canEditCell(table, row, 'x')).toBe(true);
    expect(changeSet(stageCell(NO_EDITS, table, row, 'x', '2')).updates[0]!.key).toEqual({ id: 'NaN' });
    expect(canEditCell(table, { id: null, x: 1 }, 'x')).toBe(false);
  });
});

describe('grid cells', () => {
  it('renders the text and keeps null for NULL', () => {
    expect(renderCell('Infinity')).toBe('Infinity');
    expect(renderCell('NaN')).toBe('NaN');
    expect(renderCell(null)).toBe('null');
  });

  it('opens as text in the value viewer', () => {
    expect(viewCell('Infinity', 'DOUBLE')).toEqual({ kind: 'text', text: 'Infinity' });
    expect(viewCell(null, 'DOUBLE')).toEqual({ kind: 'null' });
  });

  it('draws no magic, and a column holding one stays numbers rather than 0 to 1 bars', () => {
    expect(cellMagic('NaN', 'DOUBLE', true)).toBeNull();
    const numeric = [{ name: 'x', numeric: true }];
    expect(fractionColumns(numeric, [{ x: 0.5 }, { x: 'NaN' }])).toEqual(new Set());
    expect(fractionColumns(numeric, [{ x: 0.5 }, { x: null }])).toEqual(new Set(['x']));
  });
});

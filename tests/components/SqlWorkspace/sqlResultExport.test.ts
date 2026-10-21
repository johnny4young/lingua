import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  PYTHON_HANDOFF_ROW_CAP,
  rowsToDelimited,
  rowsToPythonSource,
  rowsToSqlInsert,
  serializeRows,
} from '../../../src/renderer/components/SqlWorkspace/sqlResultExport';

const columns = [
  { name: 'city', type: 'Utf8' },
  { name: 'orders', type: 'Int64' },
  { name: 'note', type: 'Utf8' },
];
const rows = [
  { city: 'Bogotá', orders: '412', note: 'says "hi", twice' },
  { city: null, orders: null, note: 'line\nbreak' },
];

describe('SQL result export', () => {
  it('writes RFC 4180 CSV with a header, and empty cells for NULL by default', () => {
    expect(serializeRows('csv', columns, rows, DEFAULT_EXPORT_OPTIONS)).toBe(
      'city,orders,note\nBogotá,412,"says ""hi"", twice"\n,,"line\nbreak"'
    );
  });

  it('honours the header, delimiter and NULL options', () => {
    expect(
      rowsToDelimited(columns, rows, { header: false, nullAsEmpty: false, delimiter: ';' })
    ).toBe('Bogotá;412;"says ""hi"", twice"\nNULL;NULL;"line\nbreak"');
    expect(
      rowsToDelimited(columns, [{ city: 'a,b', orders: '1', note: 'x' }], {
        header: false,
        nullAsEmpty: true,
        delimiter: ';',
      })
    ).toBe('a,b;1;x');
  });

  it('flattens tabs and newlines inside TSV cells', () => {
    expect(serializeRows('tsv', columns, rows, DEFAULT_EXPORT_OPTIONS).split('\n')).toEqual([
      'city\torders\tnote',
      'Bogotá\t412\tsays "hi", twice',
      '\t\tline break',
    ]);
  });

  it('writes one INSERT, quoting strings and keeping numbers bare', () => {
    expect(rowsToSqlInsert(columns, rows, 'top cities')).toBe(
      'INSERT INTO "top cities" ("city", "orders", "note") VALUES\n' +
        "  ('Bogotá', 412, 'says \"hi\", twice'),\n" +
        "  (NULL, NULL, 'line\nbreak');"
    );
    expect(rowsToSqlInsert(columns, [{ city: "O'Hare", orders: 'x', note: true }], '')).toContain(
      "('O''Hare', 'x', TRUE)"
    );
  });

  it('writes Markdown with pipes escaped', () => {
    expect(
      serializeRows(
        'markdown',
        [{ name: 'a|b', type: 'Utf8' }],
        [{ 'a|b': 'x|y' }],
        DEFAULT_EXPORT_OPTIONS
      )
    ).toBe('| a\\|b |\n| --- |\n| x\\|y |');
  });

  it('turns rows into Python dicts with None, booleans and numbers', () => {
    const { source, included } = rowsToPythonSource(
      [...columns, { name: 'ok', type: 'Bool' }],
      [{ city: 'Lima', orders: '7', note: null, ok: false }],
      () => '# header'
    );
    expect(included).toBe(1);
    expect(source).toContain(
      'rows = [\n    {"city": "Lima", "orders": 7, "note": None, "ok": False},\n]'
    );
    expect(source.startsWith('# header\n')).toBe(true);
  });

  it('stops at the Python row cap', () => {
    const many = Array.from({ length: PYTHON_HANDOFF_ROW_CAP + 5 }, (_, i) => ({ id: i }));
    expect(rowsToPythonSource([{ name: 'id', type: 'Int32' }], many, () => '#').included).toBe(
      PYTHON_HANDOFF_ROW_CAP
    );
  });

  it('names in the header the rows the byte cap let in', () => {
    const wide = Array.from({ length: 900 }, () => ({ text: 'x'.repeat(1024) }));
    const { source, included } = rowsToPythonSource(
      [{ name: 'text', type: 'Utf8' }],
      wide,
      (shown) => `# ${shown} rows`
    );
    expect(included).toBeLessThan(900);
    expect(source.startsWith(`# ${included} rows\n`)).toBe(true);
  });
});

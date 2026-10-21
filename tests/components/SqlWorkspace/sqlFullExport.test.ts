import { beforeEach, describe, expect, it, vi } from 'vitest';

const copyQueryToBytes = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), rowCount: 2 }));
const streamQueryRows = vi.fn(async () => ({
  columns: [{ name: 'a', type: 'Int64' }],
  rows: [{ a: '1' }, { a: '2' }],
  truncated: true,
}));
vi.mock('../../../src/renderer/runtime/duckdbExport', () => ({ copyQueryToBytes, streamQueryRows }));

const { exportFullResult } = await import('../../../src/renderer/components/SqlWorkspace/sqlFullExport');
const { DEFAULT_EXPORT_OPTIONS } = await import('../../../src/renderer/components/SqlWorkspace/sqlResultExport');

beforeEach(() => {
  copyQueryToBytes.mockClear();
  streamQueryRows.mockClear();
});

describe('exportFullResult', () => {
  it('lets DuckDB write CSV, TSV, JSON, NDJSON and Parquet with the chosen options', async () => {
    const options = { ...DEFAULT_EXPORT_OPTIONS, header: false, delimiter: ';' as const, nullAsEmpty: false };
    await exportFullResult('SELECT 1', 'csv', options);
    await exportFullResult('SELECT 1', 'tsv', DEFAULT_EXPORT_OPTIONS);
    await exportFullResult('SELECT 1', 'json', DEFAULT_EXPORT_OPTIONS);
    await exportFullResult('SELECT 1', 'ndjson', DEFAULT_EXPORT_OPTIONS);
    const parquet = await exportFullResult('SELECT 1', 'parquet', DEFAULT_EXPORT_OPTIONS);
    expect(copyQueryToBytes.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["FORMAT csv, HEADER false, DELIMITER ';', NULLSTR 'NULL'", 'csv'],
      ["FORMAT csv, HEADER true, DELIMITER E'\\t', NULLSTR ''", 'tsv'],
      ['FORMAT json, ARRAY true', 'json'],
      ['FORMAT json', 'ndjson'],
      ['FORMAT parquet', 'parquet'],
    ]);
    expect(parquet).toEqual({ data: new Uint8Array([1, 2]), rowCount: 2, truncated: false });
    expect(streamQueryRows).not.toHaveBeenCalled();
  });

  it('streams Markdown, SQL INSERT and XLSX rows through the app writers', async () => {
    const insert = await exportFullResult('SELECT a FROM t', 'sql-insert', DEFAULT_EXPORT_OPTIONS);
    expect(insert).toEqual({ data: 'INSERT INTO "result" ("a") VALUES\n  (1),\n  (2);', rowCount: 2, truncated: true });
    const xlsx = await exportFullResult('SELECT a FROM t', 'xlsx', DEFAULT_EXPORT_OPTIONS);
    expect(xlsx.data).toBeInstanceOf(Uint8Array);
    expect(streamQueryRows.mock.calls[1]![1]).toMatchObject({ cap: 1_000_000 });
  });
});

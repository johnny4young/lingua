import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { copyQueryToBytes, streamQueryRows } from '../../runtime/duckdbExport';
import {
  exportExtension,
  isTextExportFormat,
  serializeRows,
  type SqlExportFormat,
  type SqlExportOptions,
} from './sqlResultExport';

/** What a streamed export holds in memory before it stops and says so. */
export const FULL_EXPORT_ROW_CAP = 1_000_000;
export const FULL_EXPORT_CELL_CAP = 5_000_000;
export const FULL_EXPORT_BYTE_CAP = 512 * 1024 * 1024;

export interface SqlFullExportResult {
  data: string | Uint8Array;
  rowCount: number;
  /** The result had more rows than the format or the cap allow. */
  truncated: boolean;
}

interface FullExportContext {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (rows: number) => void;
}

const limits = { maxCells: FULL_EXPORT_CELL_CAP, maxBytes: FULL_EXPORT_BYTE_CAP };

/** DuckDB writes these itself; the rest stream rows through the app's serializers. */
function copyOptionsFor(format: SqlExportFormat, options: SqlExportOptions): string | null {
  const nullText = options.nullAsEmpty ? "''" : "'NULL'";
  switch (format) {
    case 'csv':
      return `FORMAT csv, HEADER ${options.header}, DELIMITER '${options.delimiter}', NULLSTR ${nullText}`;
    case 'tsv':
      return `FORMAT csv, HEADER ${options.header}, DELIMITER E'\\t', NULLSTR ${nullText}`;
    case 'json':
      return 'FORMAT json, ARRAY true';
    case 'ndjson':
      return 'FORMAT json';
    case 'parquet':
      return 'FORMAT parquet';
    default:
      return null;
  }
}

/** Runs the query again for every row it returns and writes them in `format`. */
export async function exportFullResult(
  sql: string,
  format: SqlExportFormat,
  options: SqlExportOptions,
  context: FullExportContext = {}
): Promise<SqlFullExportResult> {
  const { onProgress, ...query } = context;
  const copyOptions = copyOptionsFor(format, options);
  if (copyOptions !== null) {
    const { bytes, rowCount } = await copyQueryToBytes(sql, copyOptions, exportExtension(format), query);
    return { data: bytes, rowCount, truncated: false };
  }
  if (format === 'xlsx') {
    const { XLSX_MAX_ROWS, rowsToXlsx } = await import('./sqlXlsx');
    const read = await streamQueryRows(sql, { ...query, ...limits, cap: Math.min(XLSX_MAX_ROWS, FULL_EXPORT_ROW_CAP), ...(onProgress ? { onProgress } : {}) });
    return { data: rowsToXlsx(read.columns, read.rows), rowCount: read.rows.length, truncated: read.truncated };
  }
  const read = await streamQueryRows(sql, { ...query, ...limits, cap: FULL_EXPORT_ROW_CAP, ...(onProgress ? { onProgress } : {}) });
  const text = isTextExportFormat(format) ? serializeRows(format, read.columns, read.rows, options) : '';
  return { data: text, rowCount: read.rows.length, truncated: read.truncated };
}

/** The loaded rows as a file: text through the serializers, XLSX through the sheet writer. */
export async function exportLoadedRows(
  format: SqlExportFormat,
  columns: ReadonlyArray<SqlColumnMetadata>,
  rows: ReadonlyArray<Record<string, unknown>>,
  options: SqlExportOptions
): Promise<string | Uint8Array> {
  if (isTextExportFormat(format)) return serializeRows(format, columns, rows, options);
  if (format === 'xlsx') return (await import('./sqlXlsx')).rowsToXlsx(columns, rows);
  throw new Error('Parquet is written from the query');
}

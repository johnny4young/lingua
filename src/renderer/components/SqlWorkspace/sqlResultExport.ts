import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { quoteSqlIdentifier } from './sqlResultFormatters';

export type SqlExportFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'sql-insert';

export const SQL_EXPORT_FORMATS: ReadonlyArray<{ id: SqlExportFormat; label: string }> = [
  { id: 'csv', label: 'CSV' },
  { id: 'tsv', label: 'TSV' },
  { id: 'json', label: 'JSON' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'sql-insert', label: 'SQL INSERT' },
];

export const CSV_DELIMITERS = [',', ';', '|'] as const;
type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export interface SqlExportOptions {
  header: boolean;
  delimiter: CsvDelimiter;
  nullAsEmpty: boolean;
  /** Target table of SQL INSERT. */
  tableName: string;
}

export const DEFAULT_EXPORT_OPTIONS: SqlExportOptions = {
  header: true,
  delimiter: ',',
  nullAsEmpty: true,
  tableName: 'result',
};

const MIME: Record<SqlExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  'sql-insert': 'application/sql;charset=utf-8',
};

const EXTENSION: Record<SqlExportFormat, string> = {
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  markdown: 'md',
  'sql-insert': 'sql',
};

export const exportMimeType = (format: SqlExportFormat) => MIME[format];

export function buildExportFilename(format: SqlExportFormat, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `lingua-sql-${stamp}.${EXTENSION[format]}`;
}

type Rows = ReadonlyArray<Record<string, unknown>>;
type Columns = ReadonlyArray<SqlColumnMetadata>;

function cellText(value: unknown, nullAsEmpty: boolean): string {
  if (value === null || value === undefined) return nullAsEmpty ? '' : 'NULL';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** CSV per RFC 4180, or TSV with tabs and newlines inside cells flattened to spaces. */
export function rowsToDelimited(
  columns: Columns,
  rows: Rows,
  options: Pick<SqlExportOptions, 'header' | 'nullAsEmpty'> & { delimiter: string }
): string {
  const { delimiter } = options;
  const escape = (text: string) => {
    if (delimiter === '\t') return text.replace(/[\t\r\n]+/g, ' ');
    const special = new RegExp(`["\\r\\n${delimiter === '|' ? '\\|' : delimiter}]`);
    return special.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = rows.map(row =>
    columns.map(col => escape(cellText(row[col.name], options.nullAsEmpty))).join(delimiter)
  );
  if (options.header) lines.unshift(columns.map(col => escape(col.name)).join(delimiter));
  return lines.join('\n');
}

/** GitHub-flavoured Markdown; pipes escaped, newlines as <br>. */
function rowsToMarkdownTable(columns: Columns, rows: Rows, nullAsEmpty = true): string {
  if (columns.length === 0) return '';
  const escape = (value: unknown) =>
    cellText(value, nullAsEmpty).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const header = `| ${columns.map(c => escape(c.name)).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${columns.map(col => escape(row[col.name])).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

const sqlString = (text: string) => `'${text.replace(/'/g, "''")}'`;

function sqlLiteral(value: unknown, numeric: boolean): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : sqlString(String(value));
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return numeric && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value) ? value : sqlString(value);
  }
  return sqlString(cellText(value, false));
}

/** One INSERT with a multi-row VALUES list; column names quoted. */
export function rowsToSqlInsert(columns: Columns, rows: Rows, tableName: string): string {
  if (columns.length === 0 || rows.length === 0) return '';
  const numeric = columns.map(col => isNumericSqlType(arrowTypeToDuckDb(col.type)));
  const target = quoteSqlIdentifier(tableName.trim() || DEFAULT_EXPORT_OPTIONS.tableName);
  const names = columns.map(col => quoteSqlIdentifier(col.name)).join(', ');
  const values = rows.map(
    row => `  (${columns.map((col, i) => sqlLiteral(row[col.name], numeric[i]!)).join(', ')})`
  );
  return `INSERT INTO ${target} (${names}) VALUES\n${values.join(',\n')};`;
}

/** Same replacer as the JSON view: BigInt is not JSON-serializable. */
const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

export function serializeRows(
  format: SqlExportFormat,
  columns: Columns,
  rows: Rows,
  options: SqlExportOptions
): string {
  switch (format) {
    case 'csv':
      return rowsToDelimited(columns, rows, options);
    case 'tsv':
      return rowsToDelimited(columns, rows, { ...options, delimiter: '\t' });
    case 'json':
      return JSON.stringify(rows, jsonReplacer, 2);
    case 'markdown':
      return rowsToMarkdownTable(columns, rows, options.nullAsEmpty);
    case 'sql-insert':
      return rowsToSqlInsert(columns, rows, options.tableName);
  }
}

/** Rows a Python tab receives; bounded so a large result cannot freeze the editor. */
export const PYTHON_HANDOFF_ROW_CAP = 1000;
const PYTHON_HANDOFF_BYTE_CAP = 256 * 1024;

function pythonLiteral(value: unknown, numeric: boolean): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : `float(${JSON.stringify(String(value))})`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return numeric && /^-?\d+(\.\d+)?$/.test(value) ? value : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => pythonLiteral(item, false)).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item, false)}`
    );
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * `rows = [{...}, ...]` for a new Python tab. Stops at the row or byte cap;
 * `included` says how many rows made it in.
 */
export function rowsToPythonSource(
  columns: Columns,
  rows: Rows,
  header: string
): { source: string; included: number } {
  const numeric = columns.map(col => isNumericSqlType(arrowTypeToDuckDb(col.type)));
  const lines: string[] = [];
  let bytes = 0;
  for (const row of rows) {
    if (lines.length >= PYTHON_HANDOFF_ROW_CAP) break;
    const entries = columns.map(
      (col, i) => `${JSON.stringify(col.name)}: ${pythonLiteral(row[col.name], numeric[i]!)}`
    );
    const line = `    {${entries.join(', ')}},`;
    bytes += line.length + 1;
    if (bytes > PYTHON_HANDOFF_BYTE_CAP) break;
    lines.push(line);
  }
  const body = lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
  return {
    source: `${header}\nrows = [${body}]\n\nprint(len(rows), "rows")\n`,
    included: lines.length,
  };
}

/**
 * The SQL an import runs: read the file with DuckDB, map its columns onto a
 * new table or an existing one, and insert in one transaction.
 */

import type { SqlImportFormat } from './sqlWorkspace';

export const IMPORT_CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type SqlImportDelimiter = (typeof IMPORT_CSV_DELIMITERS)[number];

export interface SqlImportCsvOptions {
  header: boolean;
  delimiter: SqlImportDelimiter;
}

export const DEFAULT_IMPORT_CSV: SqlImportCsvOptions = { header: true, delimiter: ',' };

/** One file column and where it goes; `target: null` skips it. */
export interface SqlImportColumnMap {
  source: string;
  target: string | null;
}

export type SqlImportTarget =
  | { mode: 'new'; table: string }
  | { mode: 'existing'; table: string; schema?: string; columns: ReadonlyArray<{ name: string; type: string }> };

const SAFE_TYPE = /^[A-Za-z][A-Za-z0-9_ ,()[\]]*$/;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function readerSql(format: SqlImportFormat, file: string, csv: SqlImportCsvOptions = DEFAULT_IMPORT_CSV): string {
  switch (format) {
    case 'csv':
      return `read_csv(${text(file)}, header = ${csv.header ? 'true' : 'false'}, delim = ${text(csv.delimiter)}, auto_detect = true)`;
    case 'json':
      return `read_json_auto(${text(file)})`;
    case 'parquet':
      return `read_parquet(${text(file)})`;
  }
}

/** Maps every file column to the existing column with the same name, ignoring case, or skips it. */
export function defaultMapping(
  sourceColumns: ReadonlyArray<string>,
  target: SqlImportTarget
): SqlImportColumnMap[] {
  if (target.mode === 'new') return sourceColumns.map((source) => ({ source, target: source }));
  return sourceColumns.map((source) => ({
    source,
    target: target.columns.find((column) => column.name.toLowerCase() === source.toLowerCase())?.name ?? null,
  }));
}

export type SqlImportProblem = 'nothing-mapped' | 'duplicate-target' | 'empty-target';

export function mappingProblem(mapping: ReadonlyArray<SqlImportColumnMap>): SqlImportProblem | null {
  const targets = mapping.flatMap((entry) => (entry.target === null ? [] : [entry.target.trim()]));
  if (targets.length === 0) return 'nothing-mapped';
  if (targets.some((name) => name.length === 0)) return 'empty-target';
  if (new Set(targets.map((name) => name.toLowerCase())).size !== targets.length) return 'duplicate-target';
  return null;
}

/**
 * Statements in order. A new table is one CREATE TABLE AS; an existing one
 * is an INSERT, cast to each column's type, between BEGIN and COMMIT so a
 * failed row leaves the table as it was.
 */
export function buildImportStatements(args: {
  format: SqlImportFormat;
  file: string;
  csv?: SqlImportCsvOptions;
  target: SqlImportTarget;
  mapping: ReadonlyArray<SqlImportColumnMap>;
}): string[] {
  const { format, file, csv, target, mapping } = args;
  const reader = readerSql(format, file, csv);
  const mapped = mapping.filter((entry): entry is { source: string; target: string } => entry.target !== null);
  if (target.mode === 'new') {
    const identity = mapped.length === mapping.length && mapped.every((entry) => entry.source === entry.target);
    const select = identity
      ? '*'
      : mapped.map((entry) => `${quote(entry.source)} AS ${quote(entry.target.trim())}`).join(', ');
    return [`CREATE TABLE ${quote(target.table)} AS SELECT ${select} FROM ${reader}`];
  }
  const table = target.schema ? `${quote(target.schema)}.${quote(target.table)}` : quote(target.table);
  const typeOf = new Map(target.columns.map((column) => [column.name, column.type]));
  const columns = mapped.map((entry) => quote(entry.target)).join(', ');
  const values = mapped
    .map((entry) => {
      const type = typeOf.get(entry.target);
      // Types come from the catalog; anything outside plain type syntax inserts uncast instead.
      return type && SAFE_TYPE.test(type) ? `CAST(${quote(entry.source)} AS ${type})` : quote(entry.source);
    })
    .join(', ');
  return ['BEGIN TRANSACTION', `INSERT INTO ${table} (${columns}) SELECT ${values} FROM ${reader}`, 'COMMIT'];
}

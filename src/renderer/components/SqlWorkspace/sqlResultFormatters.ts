import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';

/**
 * Convert rows to CSV. Quotes any cell containing comma / quote /
 * newline; doubles internal quotes per RFC 4180.
 */
export function rowsToCsv(
  columns: ReadonlyArray<SqlColumnMetadata>,
  rows: ReadonlyArray<Record<string, unknown>>
): string {
  const escape = (value: unknown): string => {
    const s = stringifyCell(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => escape(c.name)).join(',');
  const lines = rows.map((row) =>
    columns.map((col) => escape(row[col.name])).join(',')
  );
  return [header, ...lines].join('\n');
}

/**
 * Convert rows to a GitHub-flavoured Markdown table. Pipes inside
 * cells are escaped; newlines become <br> because Markdown does not
 * render multi-line cells natively.
 */
export function rowsToMarkdownTable(
  columns: ReadonlyArray<SqlColumnMetadata>,
  rows: ReadonlyArray<Record<string, unknown>>
): string {
  if (columns.length === 0) return '';
  const escape = (value: unknown): string =>
    stringifyCell(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const header = `| ${columns.map((c) => c.name).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) => `| ${columns.map((col) => escape(row[col.name])).join(' | ')} |`
  );
  return [header, sep, ...body].join('\n');
}

/**
 * Quote a DuckDB identifier (table / column name) for safe inlining
 * into generated SQL. DuckDB follows ANSI quoting: wrap in double
 * quotes and double any embedded double quote. Without this a table
 * name with a space, a reserved word (e.g. `select`), mixed case (which
 * DuckDB folds to lowercase when unquoted), or an injected `";` would
 * produce broken — or statement-chaining — SQL when interpolated as a
 * bare identifier.
 */
export function quoteSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a table reference segment-by-segment. A dotted display label such
 * as `lingua_ledger.runs` is two identifiers, not one identifier containing
 * a literal dot. Keeping this separate from `quoteSqlIdentifier` prevents
 * schema-browser suggestions from producing invalid SQL for non-main tables.
 */
export function quoteSqlTableReference(tableName: string, schemaName?: string): string {
  return schemaName === undefined
    ? quoteSqlIdentifier(tableName)
    : `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
}

/**
 * Build the runnable `SELECT * FROM <table> LIMIT 100;` starter the
 * schema browser inserts into the editor. The table name is quoted so
 * any identifier the engine reports (spaces, reserved words, mixed
 * case, special characters) round-trips into a valid, single statement.
 */
export function buildSelectStarter(tableName: string, schemaName?: string): string {
  return `SELECT * FROM ${quoteSqlTableReference(tableName, schemaName)} LIMIT 100;`;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

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
 * Explorer table opens from producing invalid SQL for non-main tables.
 */
export function quoteSqlTableReference(tableName: string, schemaName?: string): string {
  return schemaName === undefined
    ? quoteSqlIdentifier(tableName)
    : `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
}

/**
 * Build the `SELECT * FROM <table> LIMIT 100;` that opening a table from
 * the Explorer runs, and that Edit in editor takes into the query. The table name is quoted so
 * any identifier the engine reports (spaces, reserved words, mixed
 * case, special characters) round-trips into a valid, single statement.
 */
export function buildSelectStarter(tableName: string, schemaName?: string): string {
  return `SELECT * FROM ${quoteSqlTableReference(tableName, schemaName)} LIMIT 100;`;
}

/** `HH:MM:SS` in the user's locale; the raw string when it is not a date. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A cell as the grid shows it: null as `null`, objects as JSON. */
export function renderCell(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

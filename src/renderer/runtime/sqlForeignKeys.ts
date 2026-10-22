/**
 * Single-column foreign keys of a Local table, read from duckdb_constraints():
 * the ones it declares (its cells link to the referenced row) and the ones
 * other tables declare against it ("Referenced by").
 */

import { quoteSqlIdentifier, quoteSqlTableReference } from '../../shared/sqlQuote';
import { executeQuery } from './duckdbClient';

export interface SqlForeignKey {
  /** The table holding the key column. */
  table: string;
  schema: string;
  column: string;
  refTable: string;
  refColumn: string;
}

export interface SqlTableForeignKeys {
  outgoing: SqlForeignKey[];
  incoming: SqlForeignKey[];
}

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Lists arrive as arrays, Arrow vectors or JSON text depending on the path. */
/** A DuckDB list column as strings, whichever shape the engine returned it in. */
export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object' && 'toArray' in value && typeof value.toArray === 'function') {
    return Array.from(value.toArray() as Iterable<unknown>, String);
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [value];
    } catch {
      return [value];
    }
  }
  return [];
}

/** A cell value as a SQL literal for an equality lookup. */
export function sqlLiteralFor(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return sqlText(typeof value === 'string' ? value : JSON.stringify(value));
}

export async function loadTableForeignKeys(table: string, schema = 'main'): Promise<SqlTableForeignKeys> {
  const outcome = await executeQuery(
    'SELECT schema_name, table_name, constraint_column_names, referenced_table, referenced_column_names ' +
      "FROM duckdb_constraints() WHERE constraint_type = 'FOREIGN KEY' " +
      `AND ((table_name = ${sqlText(table)} AND schema_name = ${sqlText(schema)}) OR referenced_table = ${sqlText(table)})`
  );
  if (outcome.status !== 'success') return { outgoing: [], incoming: [] };
  const keys: SqlTableForeignKeys = { outgoing: [], incoming: [] };
  for (const row of outcome.rows) {
    const columns = stringList(row['constraint_column_names']);
    const refColumns = stringList(row['referenced_column_names']);
    // Composite keys have no single cell to link from.
    if (columns.length !== 1 || refColumns.length !== 1) continue;
    const key: SqlForeignKey = {
      table: String(row['table_name']),
      schema: String(row['schema_name']),
      column: columns[0]!,
      refTable: String(row['referenced_table']),
      refColumn: refColumns[0]!,
    };
    if (key.table === table && key.schema === schema) keys.outgoing.push(key);
    // DuckDB keys reference a table in their own schema, so another schema's table of this name is not this one.
    if (key.refTable === table && key.schema === schema) keys.incoming.push(key);
  }
  return keys;
}

/** The SELECT a link or a "Referenced by" chip opens. */
export function buildLookupSql(table: string, schema: string, column: string, value: unknown): string {
  const target = quoteSqlTableReference(table, schema === 'main' ? undefined : schema);
  return `SELECT * FROM ${target} WHERE ${quoteSqlIdentifier(column)} = ${sqlLiteralFor(value)} LIMIT 100;`;
}

export async function countReferences(key: SqlForeignKey, value: unknown): Promise<number | null> {
  const target = quoteSqlTableReference(key.table, key.schema === 'main' ? undefined : key.schema);
  const outcome = await executeQuery(
    `SELECT count(*) AS n FROM ${target} WHERE ${quoteSqlIdentifier(key.column)} = ${sqlLiteralFor(value)}`
  );
  const n = Number(outcome.rows[0]?.['n']);
  return outcome.status === 'success' && Number.isFinite(n) ? n : null;
}

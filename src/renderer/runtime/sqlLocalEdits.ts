/** Staged edits on a Local DuckDB table: which rows it can find, and applying them in one transaction. */

import { rowEditStatements, type RowEditChanges, type RowEditTable } from '../../shared/sqlRowEdits';
import { executeQuery, runEditTransaction } from './duckdbClient';
import { stringList } from './sqlForeignKeys';

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * The edit target for a Local table: its whole primary key, or DuckDB's
 * rowid when it has none (tables made by an import have none). Null for a
 * view or a table that is gone.
 */
export async function loadLocalEditTable(name: string, schema = 'main'): Promise<RowEditTable | null> {
  const where = `table_schema = ${sqlText(schema)} AND table_name = ${sqlText(name)}`;
  const [kind, columns, keys] = await Promise.all([
    executeQuery(`SELECT table_type FROM information_schema.tables WHERE ${where}`),
    executeQuery(`SELECT column_name FROM information_schema.columns WHERE ${where} ORDER BY ordinal_position`),
    executeQuery(
      `SELECT constraint_column_names FROM duckdb_constraints() WHERE constraint_type = 'PRIMARY KEY' AND schema_name = ${sqlText(schema)} AND table_name = ${sqlText(name)}`
    ),
  ]);
  if (kind.status !== 'success' || kind.rows[0]?.['table_type'] !== 'BASE TABLE' || columns.status !== 'success') return null;
  const names = columns.rows.map((row) => String(row['column_name']));
  const primary = keys.status === 'success' ? keys.rows[0]?.['constraint_column_names'] : undefined;
  const keyColumns = primary === undefined || primary === null ? [] : stringList(primary);
  return {
    engine: 'duckdb',
    ...(schema === 'main' ? {} : { schema }),
    name,
    columns: names,
    key: keyColumns.length > 0 ? { kind: 'pk', columns: keyColumns } : { kind: 'rowid' },
  };
}

export async function applyLocalEdits(table: RowEditTable, changes: RowEditChanges): Promise<{ applied: number } | { errorMessage: string }> {
  return runEditTransaction(rowEditStatements(table, changes, true).map(({ sql }) => sql));
}

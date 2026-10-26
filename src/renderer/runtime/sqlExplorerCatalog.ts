import { parseLocalCopyOrigin } from '../../shared/sqlCopyToLocal';
import type { DuckDbConnection } from './duckdbClient';
import type {
  SqlCatalog,
  SqlSchemaColumn,
  SqlSchemaMacro,
  SqlSchemaTable,
} from '../components/SqlWorkspace/sqlExplorerModel';

const displayName = (schema: unknown, table: string) =>
  typeof schema === 'string' && schema !== 'main' ? `${schema}.${table}` : table;

/**
 * Reads what the Explorer shows from the Local engine. Tables, columns,
 * row counts and macros are separate probes; a failing optional probe
 * leaves its part empty instead of failing the whole refresh.
 */
export async function loadSqlCatalog(connection: DuckDbConnection): Promise<SqlCatalog> {
  const { rows } = await connection.query(
    'SELECT table_schema, table_name, table_type FROM information_schema.tables ' +
      "WHERE table_schema NOT IN ('pg_catalog') " +
      'ORDER BY table_schema, table_name'
  );
  const tables = new Map<string, SqlSchemaTable>();
  const systemViews: string[] = [];
  for (const row of rows) {
    const schema = row['table_schema'];
    const table = row['table_name'];
    if (typeof table !== 'string') continue;
    if (schema === 'information_schema') {
      systemViews.push(table);
      continue;
    }
    const kind = row['table_type'] === 'VIEW' ? 'view' : 'table';
    tables.set(displayName(schema, table), {
      name: displayName(schema, table),
      sqlName: table,
      kind,
      ...(typeof schema === 'string' && schema !== 'main' ? { schemaName: schema } : {}),
    });
  }

  try {
    const columnRows = await connection.query(
      'SELECT table_schema, table_name, column_name, data_type ' +
        'FROM information_schema.columns ' +
        "WHERE table_schema NOT IN ('information_schema', 'pg_catalog') " +
        'ORDER BY table_schema, table_name, ordinal_position'
    );
    const columnsByTable = new Map<string, SqlSchemaColumn[]>();
    for (const row of columnRows.rows) {
      const table = row['table_name'];
      const column = row['column_name'];
      if (typeof table !== 'string' || typeof column !== 'string') continue;
      const key = displayName(row['table_schema'], table);
      const list = columnsByTable.get(key) ?? [];
      list.push({
        name: column,
        type: typeof row['data_type'] === 'string' ? row['data_type'] : 'UNKNOWN',
      });
      columnsByTable.set(key, list);
    }
    for (const [key, columns] of columnsByTable) {
      const table = tables.get(key);
      if (table) table.columns = columns;
    }
  } catch {
    // Tables still render, name-only.
  }

  try {
    const sizes = await connection.query(
      'SELECT schema_name, table_name, estimated_size, comment FROM duckdb_tables() WHERE NOT internal'
    );
    for (const row of sizes.rows) {
      const tableName = row['table_name'];
      if (typeof tableName !== 'string') continue;
      const table = tables.get(displayName(row['schema_name'], tableName));
      const size = Number(row['estimated_size']);
      if (table && Number.isFinite(size)) table.rowCount = size;
      const copiedFrom = parseLocalCopyOrigin(row['comment']);
      if (table && copiedFrom) table.copiedFrom = copiedFrom;
    }
  } catch {
    // No counts on engines without duckdb_tables().
  }

  const macros: SqlSchemaMacro[] = [];
  try {
    const macroRows = await connection.query(
      'SELECT DISTINCT schema_name, function_name FROM duckdb_functions() ' +
        "WHERE NOT internal AND function_type IN ('macro', 'table_macro') " +
        'ORDER BY schema_name, function_name'
    );
    for (const row of macroRows.rows) {
      const schemaName = row['schema_name'];
      const name = row['function_name'];
      if (typeof schemaName === 'string' && typeof name === 'string') {
        macros.push({ schemaName, name });
      }
    }
  } catch {
    // Macros are optional.
  }

  return { tables: [...tables.values()], macros, systemViews };
}

/**
 * MySQL catalog levels from information_schema. Names travel as prepared
 * statement values; SHOW CREATE, which takes no parameters, gets them quoted
 * with backticks doubled. Each SELECT stops after 25 seconds.
 */

import {
  MAX_INTROSPECT_COLUMNS,
  MAX_INTROSPECT_OBJECTS,
  type SqlDbColumnInfo,
  type SqlDbIndexInfo,
  type SqlDbIntrospect,
  type SqlDbIntrospectResult,
  type SqlDbObjectKind,
} from '../../shared/sqlDb';
import type { CatalogQuery } from '../../shared/sqlCatalog/postgres';

const quote = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const count = (value: unknown) => (value === null || value === undefined ? undefined : Number(value));
const HINT = '/*+ MAX_EXECUTION_TIME(25000) */';
const SYSTEM_SCHEMAS = "('mysql','information_schema','performance_schema','sys')";

const SCHEMAS = `
SELECT ${HINT} s.SCHEMA_NAME AS name,
  (SELECT COUNT(*) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME)
  + (SELECT COUNT(*) FROM information_schema.ROUTINES r WHERE r.ROUTINE_SCHEMA = s.SCHEMA_NAME) AS objects
FROM information_schema.SCHEMATA s
WHERE s.SCHEMA_NAME NOT IN ${SYSTEM_SCHEMAS}
ORDER BY s.SCHEMA_NAME = DATABASE() DESC, s.SCHEMA_NAME LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`;

const OBJECTS = `
SELECT ${HINT} * FROM (
  SELECT IF(t.TABLE_TYPE = 'VIEW', 'view', 'table') AS kind, t.TABLE_NAME AS name,
    IF(t.TABLE_TYPE = 'VIEW', NULL, t.TABLE_ROWS) AS est_rows, NULL AS signature
  FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = ?
  UNION ALL
  SELECT LOWER(r.ROUTINE_TYPE), r.ROUTINE_NAME, NULL, NULL FROM information_schema.ROUTINES r WHERE r.ROUTINE_SCHEMA = ?
) objects ORDER BY kind, name LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`;

const COLUMNS = `
SELECT ${HINT} TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT ${MAX_INTROSPECT_COLUMNS + 1}`;

const DETAIL_COLUMNS = `
SELECT ${HINT} COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS col_key
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`;

const DETAIL_REFERENCES = `
SELECT ${HINT} COLUMN_NAME AS col, REFERENCED_TABLE_SCHEMA AS ref_schema, REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_column
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`;

const DETAIL_INDEXES = `
SELECT ${HINT} INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS non_unique
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`;

const DETAIL_SIZE = `
SELECT ${HINT} TABLE_ROWS AS est_rows, DATA_LENGTH + INDEX_LENGTH AS size FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`;

const SHOW_CREATE: Partial<Record<SqlDbObjectKind, { statement: string; column: string }>> = {
  table: { statement: 'SHOW CREATE TABLE', column: 'Create Table' },
  view: { statement: 'SHOW CREATE VIEW', column: 'Create View' },
  function: { statement: 'SHOW CREATE FUNCTION', column: 'Create Function' },
  procedure: { statement: 'SHOW CREATE PROCEDURE', column: 'Create Procedure' },
};

async function ddlOf(query: CatalogQuery, schema: string, name: string, kind: SqlDbObjectKind): Promise<string | undefined> {
  const show = SHOW_CREATE[kind];
  if (!show) return undefined;
  try {
    const [row] = await query(`${show.statement} ${quote(schema)}.${quote(name)}`, []);
    const ddl = row?.[show.column];
    return typeof ddl === 'string' ? ddl : undefined;
  } catch {
    // Routines need privileges to show their body; the rest of the detail still stands.
    return undefined;
  }
}

async function detail(query: CatalogQuery, request: Extract<SqlDbIntrospect, { level: 'detail' }>): Promise<SqlDbIntrospectResult> {
  const { schema, name, kind } = request;
  const ddl = await ddlOf(query, schema, name, kind);
  if (kind !== 'table' && kind !== 'view') {
    return { detail: { kind, schema, name, columns: [], indexes: [], ...(ddl ? { ddl } : {}) } };
  }
  const columnRows = await query(DETAIL_COLUMNS, [schema, name]);
  const referenceRows = await query(DETAIL_REFERENCES, [schema, name]);
  const indexRows = await query(DETAIL_INDEXES, [schema, name]);
  const [sizeRow] = await query(DETAIL_SIZE, [schema, name]);
  const references = new Map(
    referenceRows.map((row) => [String(row.col), { schema: String(row.ref_schema), table: String(row.ref_table), column: String(row.ref_column) }])
  );
  const columns: SqlDbColumnInfo[] = columnRows.map((row) => {
    const column = String(row.name);
    return {
      name: column,
      type: String(row.type),
      nullable: row.nullable === 'YES',
      ...(row.dflt !== null && row.dflt !== undefined ? { default: String(row.dflt) } : {}),
      ...(row.col_key === 'PRI' ? { primaryKey: true } : {}),
      ...(references.has(column) ? { references: references.get(column)! } : {}),
    };
  });
  const byIndex = new Map<string, SqlDbIndexInfo>();
  for (const row of indexRows) {
    const indexName = String(row.name);
    const index = byIndex.get(indexName) ?? { name: indexName, columns: [], unique: Number(row.non_unique) === 0, primary: indexName === 'PRIMARY' };
    index.columns.push(String(row.col));
    byIndex.set(indexName, index);
  }
  return {
    detail: {
      kind,
      schema,
      name,
      columns,
      indexes: [...byIndex.values()],
      ...(kind === 'table' && count(sizeRow?.est_rows) !== undefined ? { rowEstimate: count(sizeRow?.est_rows)! } : {}),
      ...(kind === 'table' && count(sizeRow?.size) !== undefined ? { sizeBytes: count(sizeRow?.size)! } : {}),
      ...(ddl ? { ddl } : {}),
    },
  };
}

export async function introspectMysql(query: CatalogQuery, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult> {
  switch (request.level) {
    case 'schemas': {
      const rows = await query(SCHEMAS, []);
      return {
        schemas: rows.slice(0, MAX_INTROSPECT_OBJECTS).map((row) => ({ name: String(row.name), objects: Number(row.objects) })),
        truncated: rows.length > MAX_INTROSPECT_OBJECTS,
      };
    }
    case 'objects': {
      const rows = await query(OBJECTS, [request.schema, request.schema]);
      return {
        objects: rows.slice(0, MAX_INTROSPECT_OBJECTS).map((row) => ({
          kind: String(row.kind) as SqlDbObjectKind,
          name: String(row.name),
          ...(count(row.est_rows) !== undefined ? { rowEstimate: count(row.est_rows)! } : {}),
        })),
        truncated: rows.length > MAX_INTROSPECT_OBJECTS,
      };
    }
    case 'columns': {
      const rows = await query(COLUMNS, [request.schema]);
      return {
        columns: rows.slice(0, MAX_INTROSPECT_COLUMNS).map((row) => ({ table: String(row.tbl), name: String(row.name), type: String(row.type) })),
        truncated: rows.length > MAX_INTROSPECT_COLUMNS,
      };
    }
    case 'detail':
      return detail(query, request);
  }
}

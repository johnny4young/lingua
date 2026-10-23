/**
 * SQL Server catalog levels from sys views. Names travel as `@p1`, `@p2`
 * parameters; a table's DDL is written from its columns and keys, since SQL
 * Server keeps no CREATE TABLE text.
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
import type { CatalogQuery } from './postgresCatalog';

const quote = (name: string) => `[${name.replaceAll(']', ']]')}]`;
const count = (value: unknown) => (value === null || value === undefined ? undefined : Number(value));
const OBJECT = 'OBJECT_ID(QUOTENAME(@p1) + N\'.\' + QUOTENAME(@p2))';
const KINDS = "('U','V','P','FN','IF','TF','SO')";

const SCHEMAS = `
SELECT TOP (${MAX_INTROSPECT_OBJECTS + 1}) s.name AS name,
  (SELECT COUNT(*) FROM sys.objects o WHERE o.schema_id = s.schema_id AND o.is_ms_shipped = 0 AND o.type IN ${KINDS}) AS objects
FROM sys.schemas s
WHERE s.schema_id < 16384 AND s.name NOT IN (N'sys', N'INFORMATION_SCHEMA', N'guest')
ORDER BY CASE WHEN s.name = SCHEMA_NAME() THEN 0 ELSE 1 END, s.name`;

const OBJECTS = `
SELECT TOP (${MAX_INTROSPECT_OBJECTS + 1}) x.kind, x.name, x.est_rows FROM (
  SELECT CASE o.type WHEN 'U' THEN 'table' WHEN 'V' THEN 'view' WHEN 'P' THEN 'procedure' WHEN 'SO' THEN 'sequence' ELSE 'function' END AS kind,
    o.name AS name,
    CASE WHEN o.type = 'U' THEN (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) END AS est_rows
  FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
  WHERE s.name = @p1 AND o.is_ms_shipped = 0 AND o.type IN ${KINDS}
) x ORDER BY x.kind, x.name`;

const COLUMNS = `
SELECT TOP (${MAX_INTROSPECT_COLUMNS + 1}) t.name AS tbl, c.name AS name, TYPE_NAME(c.user_type_id) AS type
FROM sys.columns c JOIN sys.objects t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = @p1 AND t.type IN ('U', 'V') ORDER BY t.name, c.column_id`;

const DETAIL_COLUMNS = `
SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS len, c.NUMERIC_PRECISION AS prec,
  c.NUMERIC_SCALE AS scale, c.IS_NULLABLE AS nullable, c.COLUMN_DEFAULT AS dflt
FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = @p1 AND c.TABLE_NAME = @p2 ORDER BY c.ORDINAL_POSITION`;

const DETAIL_REFERENCES = `
SELECT pc.name AS col, rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_column
FROM sys.foreign_key_columns fkc
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE fkc.parent_object_id = ${OBJECT}`;

const DETAIL_INDEXES = `
SELECT i.name AS name, col.name AS col, i.is_unique AS is_unique, i.is_primary_key AS is_primary
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
WHERE i.object_id = ${OBJECT} AND i.type > 0
ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal`;

const DETAIL_SIZE = `
SELECT (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = ${OBJECT} AND p.index_id IN (0, 1)) AS est_rows,
  (SELECT SUM(a.total_pages) * 8192 FROM sys.partitions p JOIN sys.allocation_units a ON a.container_id = p.partition_id
   WHERE p.object_id = ${OBJECT}) AS size`;

const DEFINITION = `SELECT OBJECT_DEFINITION(${OBJECT}) AS ddl`;

const SEQUENCE = `
SELECT TYPE_NAME(q.user_type_id) AS type, CAST(q.start_value AS nvarchar(40)) AS start, CAST(q.increment AS nvarchar(40)) AS step
FROM sys.sequences q WHERE q.object_id = ${OBJECT}`;

/** A column type as T-SQL writes it: lengths for strings and binaries, precision for decimals. */
function typeOf(row: Record<string, unknown>): string {
  const type = String(row.type);
  const length = count(row.len);
  if (length !== undefined && /char|binary/i.test(type)) return `${type}(${length === -1 ? 'max' : length})`;
  if (/^(decimal|numeric)$/i.test(type) && row.prec !== null && row.prec !== undefined) return `${type}(${Number(row.prec)},${Number(row.scale ?? 0)})`;
  return type;
}

function tableDdl(schema: string, name: string, columns: SqlDbColumnInfo[], indexes: SqlDbIndexInfo[]): string {
  const lines = columns.map((column) => `  ${quote(column.name)} ${column.type}${column.nullable ? ' NULL' : ' NOT NULL'}${column.default ? ` DEFAULT ${column.default}` : ''}`);
  const primary = indexes.find((index) => index.primary);
  if (primary) lines.push(`  CONSTRAINT ${quote(primary.name)} PRIMARY KEY (${primary.columns.map(quote).join(', ')})`);
  return `CREATE TABLE ${quote(schema)}.${quote(name)} (\n${lines.join(',\n')}\n);`;
}

async function detail(query: CatalogQuery, request: Extract<SqlDbIntrospect, { level: 'detail' }>): Promise<SqlDbIntrospectResult> {
  const { schema, name, kind } = request;
  const names = [schema, name];
  if (kind === 'sequence') {
    const [row] = await query(SEQUENCE, names);
    const ddl = row ? `CREATE SEQUENCE ${quote(schema)}.${quote(name)} AS ${String(row.type)} START WITH ${String(row.start)} INCREMENT BY ${String(row.step)};` : undefined;
    return { detail: { kind, schema, name, columns: [], indexes: [], ...(ddl ? { ddl } : {}) } };
  }
  if (kind !== 'table' && kind !== 'view') {
    const [row] = await query(DEFINITION, names).catch(() => []);
    const ddl = typeof row?.ddl === 'string' ? row.ddl : undefined;
    return { detail: { kind, schema, name, columns: [], indexes: [], ...(ddl ? { ddl } : {}) } };
  }
  const columnRows = await query(DETAIL_COLUMNS, names);
  const referenceRows = await query(DETAIL_REFERENCES, names);
  const indexRows = await query(DETAIL_INDEXES, names);
  const [sizeRow] = kind === 'table' ? await query(DETAIL_SIZE, names) : [];
  const byIndex = new Map<string, SqlDbIndexInfo>();
  for (const row of indexRows) {
    const indexName = String(row.name);
    const index = byIndex.get(indexName) ?? { name: indexName, columns: [], unique: row.is_unique === true || Number(row.is_unique) === 1, primary: row.is_primary === true || Number(row.is_primary) === 1 };
    index.columns.push(String(row.col));
    byIndex.set(indexName, index);
  }
  const indexes = [...byIndex.values()];
  const primaryColumns = new Set(indexes.find((index) => index.primary)?.columns ?? []);
  const references = new Map(
    referenceRows.map((row) => [String(row.col), { schema: String(row.ref_schema), table: String(row.ref_table), column: String(row.ref_column) }])
  );
  const columns: SqlDbColumnInfo[] = columnRows.map((row) => {
    const column = String(row.name);
    return {
      name: column,
      type: typeOf(row),
      nullable: row.nullable === 'YES',
      ...(row.dflt !== null && row.dflt !== undefined ? { default: String(row.dflt) } : {}),
      ...(primaryColumns.has(column) ? { primaryKey: true } : {}),
      ...(references.has(column) ? { references: references.get(column)! } : {}),
    };
  });
  const [definition] = kind === 'view' ? await query(DEFINITION, names).catch(() => []) : [];
  const ddl = kind === 'table' ? tableDdl(schema, name, columns, indexes) : typeof definition?.ddl === 'string' ? definition.ddl : undefined;
  return {
    detail: {
      kind,
      schema,
      name,
      columns,
      indexes,
      ...(count(sizeRow?.est_rows) !== undefined ? { rowEstimate: count(sizeRow?.est_rows)! } : {}),
      ...(count(sizeRow?.size) !== undefined ? { sizeBytes: count(sizeRow?.size)! } : {}),
      ...(ddl ? { ddl } : {}),
    },
  };
}

export async function introspectSqlServer(query: CatalogQuery, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult> {
  switch (request.level) {
    case 'schemas': {
      const rows = await query(SCHEMAS, []);
      return {
        schemas: rows.slice(0, MAX_INTROSPECT_OBJECTS).map((row) => ({ name: String(row.name), objects: Number(row.objects) })),
        truncated: rows.length > MAX_INTROSPECT_OBJECTS,
      };
    }
    case 'objects': {
      const rows = await query(OBJECTS, [request.schema]);
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

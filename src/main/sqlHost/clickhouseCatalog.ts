/**
 * ClickHouse catalog levels from system tables. Names travel as typed query
 * parameters (`{p1:String}`); databases stand in for schemas. A sorting key
 * is ClickHouse's primary key, which does not make rows unique.
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

const count = (value: unknown) => (value === null || value === undefined || value === '' ? undefined : Number(value));
const SYSTEM_DATABASES = "('system', 'INFORMATION_SCHEMA', 'information_schema')";

const SCHEMAS = `
SELECT d.name AS name, countIf(t.name != '' AND NOT startsWith(t.name, '.inner')) AS objects
FROM system.databases d LEFT JOIN system.tables t ON t.database = d.name
WHERE d.name NOT IN ${SYSTEM_DATABASES}
GROUP BY d.name ORDER BY d.name = currentDatabase() DESC, d.name LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`;

const OBJECTS = `
SELECT multiIf(engine = 'View', 'view', engine = 'MaterializedView', 'matview', 'table') AS kind, name, total_rows AS est_rows
FROM system.tables WHERE database = {p1:String} AND NOT is_temporary AND NOT startsWith(name, '.inner')
ORDER BY kind, name LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`;

const COLUMNS = `
SELECT table AS tbl, name, type FROM system.columns WHERE database = {p1:String}
ORDER BY table, position LIMIT ${MAX_INTROSPECT_COLUMNS + 1}`;

const DETAIL_COLUMNS = `
SELECT name, type, default_kind, default_expression, is_in_primary_key FROM system.columns
WHERE database = {p1:String} AND table = {p2:String} ORDER BY position`;

const DETAIL_TABLE = `
SELECT engine, total_rows, total_bytes, primary_key, create_table_query FROM system.tables
WHERE database = {p1:String} AND name = {p2:String}`;

const DETAIL_INDEXES = `
SELECT name, expr FROM system.data_skipping_indices WHERE database = {p1:String} AND table = {p2:String} ORDER BY name`;

async function detail(query: CatalogQuery, request: Extract<SqlDbIntrospect, { level: 'detail' }>): Promise<SqlDbIntrospectResult> {
  const { schema, name, kind } = request;
  const names = [schema, name];
  const [table] = await query(DETAIL_TABLE, names);
  const columnRows = await query(DETAIL_COLUMNS, names);
  const skipping = await query(DETAIL_INDEXES, names).catch(() => []);
  const columns: SqlDbColumnInfo[] = columnRows.map((row) => ({
    name: String(row.name),
    type: String(row.type),
    nullable: /^Nullable\(/.test(String(row.type)),
    ...(row.default_kind && row.default_expression ? { default: `${String(row.default_kind)} ${String(row.default_expression)}` } : {}),
    ...(Number(row.is_in_primary_key) === 1 ? { primaryKey: true } : {}),
  }));
  const primary = String(table?.primary_key ?? '')
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
  const indexes: SqlDbIndexInfo[] = [
    ...(primary.length > 0 ? [{ name: 'PRIMARY KEY', columns: primary, unique: false, primary: true }] : []),
    ...skipping.map((row) => ({ name: String(row.name), columns: [String(row.expr)], unique: false, primary: false })),
  ];
  const ddl = typeof table?.create_table_query === 'string' && table.create_table_query ? table.create_table_query : undefined;
  return {
    detail: {
      kind,
      schema,
      name,
      columns,
      indexes,
      ...(kind === 'table' && count(table?.total_rows) !== undefined ? { rowEstimate: count(table?.total_rows)! } : {}),
      ...(kind === 'table' && count(table?.total_bytes) !== undefined ? { sizeBytes: count(table?.total_bytes)! } : {}),
      ...(ddl ? { ddl } : {}),
    },
  };
}

export async function introspectClickHouse(query: CatalogQuery, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult> {
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

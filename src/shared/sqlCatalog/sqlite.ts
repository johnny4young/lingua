/**
 * SQLite catalog levels from sqlite_master and the table-valued pragmas, with
 * names as bind parameters. A file has the one `main` schema.
 */

import {
  MAX_INTROSPECT_COLUMNS,
  MAX_INTROSPECT_OBJECTS,
  type SqlDbColumnInfo,
  type SqlDbIndexInfo,
  type SqlDbIntrospect,
  type SqlDbIntrospectResult,
  type SqlDbObjectKind,
} from '../sqlDb';
import type { CatalogQuery } from './postgres';

/** Declared column types, by SQLite affinity, in the names the grid knows. */
export function sqliteColumnType(declared: string | null | undefined): string {
  const type = (declared ?? '').toUpperCase();
  if (type === '') return 'VALUE';
  if (/INT/.test(type)) return type === 'INTEGER' || type === 'BIGINT' || type === 'SMALLINT' ? type : 'BIGINT';
  if (/REAL|FLOA|DOUB/.test(type)) return 'DOUBLE';
  if (/DECIMAL|NUMERIC/.test(type)) return 'DECIMAL';
  if (/BLOB/.test(type)) return 'BLOB';
  return type;
}

// D1 refuses any read of its own `_cf_` tables, which would fail the whole level.
const userObject = (alias = '', cloudflare = false) =>
  `${alias}type IN ('table','view') AND ${alias}name NOT LIKE 'sqlite\\_%' ESCAPE '\\'${cloudflare ? ` AND ${alias}name NOT LIKE '\\_cf\\_%' ESCAPE '\\'` : ''}`;

export async function introspectSqlite(query: CatalogQuery, request: SqlDbIntrospect, options: { cloudflare?: boolean } = {}): Promise<SqlDbIntrospectResult> {
  const cloudflare = options.cloudflare === true;
  switch (request.level) {
    case 'schemas': {
      const [row] = await query(`SELECT COUNT(*) AS objects FROM sqlite_master WHERE ${userObject('', cloudflare)}`, []);
      return { schemas: [{ name: 'main', objects: Number(row?.objects ?? 0) }] };
    }
    case 'objects': {
      if (request.schema !== 'main') return { objects: [], truncated: false };
      const rows = await query(`SELECT type AS kind, name FROM sqlite_master WHERE ${userObject('', cloudflare)} ORDER BY type, name LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`, []);
      return {
        objects: rows.slice(0, MAX_INTROSPECT_OBJECTS).map((row) => ({ kind: String(row.kind) as SqlDbObjectKind, name: String(row.name) })),
        truncated: rows.length > MAX_INTROSPECT_OBJECTS,
      };
    }
    case 'columns': {
      if (request.schema !== 'main') return { columns: [], truncated: false };
      const rows = await query(
        `SELECT m.name AS tbl, p.name AS name, p.type AS type FROM sqlite_master m JOIN pragma_table_info(m.name) p
         WHERE ${userObject('m.', cloudflare)} ORDER BY m.name, p.cid LIMIT ${MAX_INTROSPECT_COLUMNS + 1}`,
        []
      );
      return {
        columns: rows.slice(0, MAX_INTROSPECT_COLUMNS).map((row) => ({ table: String(row.tbl), name: String(row.name), type: String(row.type || 'VALUE') })),
        truncated: rows.length > MAX_INTROSPECT_COLUMNS,
      };
    }
    case 'detail': {
      const { name, kind } = request;
      const [master] = await query('SELECT sql FROM sqlite_master WHERE name = ?', [name]);
      const columnRows = await query('SELECT name, type, "notnull" AS not_null, dflt_value AS dflt, pk FROM pragma_table_info(?) ORDER BY cid', [name]);
      const keyRows = await query('SELECT [from] AS col, [table] AS ref_table, [to] AS ref_column FROM pragma_foreign_key_list(?)', [name]);
      const indexRows = await query(
        'SELECT l.name AS name, l."unique" AS uniq, l.origin AS origin, i.name AS col FROM pragma_index_list(?) l JOIN pragma_index_info(l.name) i ORDER BY l.name, i.seqno',
        [name]
      );
      const references = new Map(keyRows.map((row) => [String(row.col), { schema: 'main', table: String(row.ref_table), column: String(row.ref_column ?? '') }]));
      const columns: SqlDbColumnInfo[] = columnRows.map((row) => {
        const column = String(row.name);
        return {
          name: column,
          type: String(row.type || 'VALUE'),
          nullable: Number(row.not_null) === 0,
          ...(row.dflt !== null && row.dflt !== undefined ? { default: String(row.dflt) } : {}),
          ...(Number(row.pk) > 0 ? { primaryKey: true } : {}),
          ...(references.has(column) ? { references: references.get(column)! } : {}),
        };
      });
      const byIndex = new Map<string, SqlDbIndexInfo>();
      for (const row of indexRows) {
        const indexName = String(row.name);
        const index = byIndex.get(indexName) ?? { name: indexName, columns: [], unique: Number(row.uniq) === 1, primary: row.origin === 'pk' };
        index.columns.push(String(row.col));
        byIndex.set(indexName, index);
      }
      const ddl = typeof master?.sql === 'string' ? `${master.sql};` : undefined;
      return { detail: { kind, schema: 'main', name, columns, indexes: [...byIndex.values()], ...(ddl ? { ddl } : {}) } };
    }
  }
}

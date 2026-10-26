/**
 * Postgres catalog levels from pg_catalog. Schema and object names only
 * travel as bind parameters or through format('%I'), never into the SQL text.
 */

import {
  MAX_INTROSPECT_COLUMNS,
  MAX_INTROSPECT_OBJECTS,
  type SqlDbColumnInfo,
  type SqlDbIndexInfo,
  type SqlDbIntrospect,
  type SqlDbIntrospectResult,
  type SqlDbObjectInfo,
  type SqlDbObjectKind,
} from '../sqlDb';

const TYPE_NAMES: Readonly<Record<number, string>> = {
  16: 'BOOLEAN',
  17: 'BLOB',
  18: 'CHAR',
  19: 'NAME',
  20: 'BIGINT',
  21: 'SMALLINT',
  23: 'INTEGER',
  25: 'TEXT',
  26: 'OID',
  114: 'JSON',
  142: 'XML',
  700: 'REAL',
  701: 'DOUBLE',
  790: 'MONEY',
  1042: 'CHAR',
  1043: 'VARCHAR',
  1082: 'DATE',
  1083: 'TIME',
  1114: 'TIMESTAMP',
  1184: 'TIMESTAMP WITH TIME ZONE',
  1186: 'INTERVAL',
  1266: 'TIME WITH TIME ZONE',
  1700: 'DECIMAL',
  2950: 'UUID',
  3802: 'JSONB',
};

/** A result column's type from its OID and modifier, as the grid names it. */
export function postgresColumnType(oid: number, modifier = -1): string {
  if (oid === 1700 && modifier > 4) {
    const mod = modifier - 4;
    return `DECIMAL(${(mod >> 16) & 0xffff},${mod & 0xffff})`;
  }
  return TYPE_NAMES[oid] ?? `OID ${oid}`;
}

/** Rows the planner expects, from `EXPLAIN (FORMAT JSON)` output as text or parsed. */
export function explainRowEstimate(plan: unknown): number | null {
  const parsed = typeof plan === 'string' ? JSON.parse(plan) : plan;
  const plan0 = Array.isArray(parsed) ? parsed[0]?.Plan : undefined;
  // A write's top node reports 0; the scan below it holds the estimate.
  const node = plan0?.['Node Type'] === 'ModifyTable' && Array.isArray(plan0.Plans) ? plan0.Plans[0] : plan0;
  const rows = node?.['Plan Rows'];
  return typeof rows === 'number' ? rows : null;
}

type Rows = Array<Record<string, unknown>>;
export type CatalogQuery = (sql: string, values: unknown[]) => Promise<Rows>;

const text = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
const count = (value: unknown) => (value === null || value === undefined ? undefined : Number(value));

const SCHEMAS = `
SELECT n.nspname AS name,
  (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r','p','v','m','S') AND NOT c.relispartition)
  + (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = n.oid AND p.prokind IN ('f','p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')) AS objects
FROM pg_namespace n
WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema' AND has_schema_privilege(n.oid, 'USAGE')
ORDER BY n.nspname = 'public' DESC, n.nspname LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`;

const OBJECTS = `
SELECT * FROM (
  SELECT CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'S' THEN 'sequence' ELSE 'table' END AS kind,
    c.relname AS name,
    CASE WHEN c.relkind IN ('r','p','m') AND c.reltuples >= 0 THEN c.reltuples::bigint END AS rows,
    NULL::text AS signature
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','S') AND NOT c.relispartition
  UNION ALL
  SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, p.proname, NULL, oidvectortypes(p.proargtypes)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = $1 AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'extension', e.extname, NULL, e.extversion
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = $1
) objects ORDER BY kind, name LIMIT ${MAX_INTROSPECT_OBJECTS + 1}`;

const COLUMNS = `
SELECT c.relname AS "table", a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m') AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum LIMIT ${MAX_INTROSPECT_COLUMNS + 1}`;

// The relation, resolved from quoted names so case and odd characters survive.
const REL = `to_regclass(format('%I.%I', $1::text, $2::text))`;

const DETAIL_COLUMNS = `
SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
  pg_get_expr(d.adbin, d.adrelid) AS "default"
FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = ${REL} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;

const DETAIL_KEYS = `
SELECT con.contype AS type, a.attname AS "column", nf.nspname AS ref_schema, cf.relname AS ref_table, af.attname AS ref_column
FROM pg_constraint con
CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
LEFT JOIN pg_class cf ON cf.oid = con.confrelid
LEFT JOIN pg_namespace nf ON nf.oid = cf.relnamespace
LEFT JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = con.confkey[k.ord]
WHERE con.conrelid = ${REL} AND con.contype IN ('p','f') AND (con.contype = 'p' OR array_length(con.conkey, 1) = 1)`;

const DETAIL_INDEXES = `
SELECT i.relname AS name, ix.indisunique AS "unique", ix.indisprimary AS "primary",
  ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k, true) FROM generate_series(1, ix.indnkeyatts) k) AS columns
FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
WHERE ix.indrelid = ${REL} ORDER BY ix.indisprimary DESC, i.relname`;

const DETAIL_SIZE = `
SELECT pg_total_relation_size(c.oid) AS size, CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint END AS rows, c.relkind AS kind,
  CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END AS viewdef
FROM pg_class c WHERE c.oid = ${REL}`;

const DETAIL_CONSTRAINTS = `
SELECT conname AS name, pg_get_constraintdef(oid, true) AS def FROM pg_constraint
WHERE conrelid = ${REL} ORDER BY contype = 'p' DESC, conname`;

const FUNCTION_DEF = `
SELECT pg_get_functiondef(to_regprocedure(format('%I.%I(%s)', $1::text, $2::text, $3::text))) AS def`;

const SEQUENCE_DEF = `
SELECT start_value, increment_by, min_value, max_value, cycle FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2`;

const EXTENSION_DEF = `
SELECT e.extversion AS version FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = $1 AND e.extname = $2`;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function detail(query: CatalogQuery, request: Extract<SqlDbIntrospect, { level: 'detail' }>): Promise<SqlDbIntrospectResult> {
  const { schema, name, kind } = request;
  const qualified = `${quote(schema)}.${quote(name)}`;
  const base = { kind, schema, name, columns: [] as SqlDbColumnInfo[], indexes: [] as SqlDbIndexInfo[] };
  if (kind === 'function' || kind === 'procedure') {
    const [row] = await query(FUNCTION_DEF, [schema, name, request.signature ?? '']);
    return { detail: { ...base, ...(text(row?.def) ? { ddl: text(row?.def)! } : {}) } };
  }
  if (kind === 'sequence') {
    const [row] = await query(SEQUENCE_DEF, [schema, name]);
    const ddl = row
      ? `CREATE SEQUENCE ${qualified}\n  START WITH ${row.start_value} INCREMENT BY ${row.increment_by}\n  MINVALUE ${row.min_value} MAXVALUE ${row.max_value}${row.cycle ? ' CYCLE' : ''};`
      : undefined;
    return { detail: { ...base, ...(ddl ? { ddl } : {}) } };
  }
  if (kind === 'extension') {
    const [row] = await query(EXTENSION_DEF, [schema, name]);
    return { detail: { ...base, ddl: `CREATE EXTENSION ${quote(name)}${row?.version ? ` VERSION '${String(row.version).replaceAll("'", "''")}'` : ''} SCHEMA ${quote(schema)};` } };
  }
  // One client runs one query at a time.
  const columnRows = await query(DETAIL_COLUMNS, [schema, name]);
  const keyRows = await query(DETAIL_KEYS, [schema, name]);
  const indexRows = await query(DETAIL_INDEXES, [schema, name]);
  const [sizeRow] = await query(DETAIL_SIZE, [schema, name]);
  const constraintRows = await query(DETAIL_CONSTRAINTS, [schema, name]);
  const primary = new Set(keyRows.filter((row) => row.type === 'p').map((row) => String(row.column)));
  const references = new Map(
    keyRows
      .filter((row) => row.type === 'f' && row.ref_table)
      .map((row) => [String(row.column), { schema: String(row.ref_schema), table: String(row.ref_table), column: String(row.ref_column) }])
  );
  const columns: SqlDbColumnInfo[] = columnRows.map((row) => {
    const column = String(row.name);
    return {
      name: column,
      type: String(row.type),
      nullable: row.nullable === true,
      ...(text(row.default) ? { default: text(row.default)! } : {}),
      ...(primary.has(column) ? { primaryKey: true } : {}),
      ...(references.has(column) ? { references: references.get(column)! } : {}),
    };
  });
  const indexes: SqlDbIndexInfo[] = indexRows.map((row) => ({
    name: String(row.name),
    columns: Array.isArray(row.columns) ? row.columns.map(String) : [],
    unique: row.unique === true,
    primary: row.primary === true,
  }));
  let ddl: string | undefined;
  if (kind === 'view' || kind === 'matview') {
    ddl = sizeRow?.viewdef ? `CREATE ${kind === 'matview' ? 'MATERIALIZED ' : ''}VIEW ${qualified} AS\n${String(sizeRow.viewdef).trimEnd()}` : undefined;
  } else {
    const lines = [
      ...columns.map((column) => `  ${quote(column.name)} ${column.type}${column.nullable ? '' : ' NOT NULL'}${column.default ? ` DEFAULT ${column.default}` : ''}`),
      ...constraintRows.map((row) => `  CONSTRAINT ${quote(String(row.name))} ${String(row.def)}`),
    ];
    ddl = `CREATE TABLE ${qualified} (\n${lines.join(',\n')}\n);`;
    const extra = indexes.filter((index) => !index.primary && !constraintRows.some((row) => row.name === index.name));
    if (extra.length > 0) ddl += `\n${extra.map((index) => `-- index ${index.name} (${index.columns.join(', ')})`).join('\n')}`;
  }
  return {
    detail: {
      ...base,
      columns,
      indexes,
      ...(count(sizeRow?.rows) !== undefined ? { rowEstimate: count(sizeRow?.rows)! } : {}),
      ...(count(sizeRow?.size) !== undefined ? { sizeBytes: count(sizeRow?.size)! } : {}),
      ...(ddl ? { ddl } : {}),
    },
  };
}

export async function introspectPostgres(query: CatalogQuery, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult> {
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
      const objects: SqlDbObjectInfo[] = rows.slice(0, MAX_INTROSPECT_OBJECTS).map((row) => ({
        kind: String(row.kind) as SqlDbObjectKind,
        name: String(row.name),
        ...(count(row.rows) !== undefined ? { rowEstimate: count(row.rows)! } : {}),
        ...(text(row.signature) !== undefined ? { signature: text(row.signature)! } : {}),
      }));
      return { objects, truncated: rows.length > MAX_INTROSPECT_OBJECTS };
    }
    case 'columns': {
      const rows = await query(COLUMNS, [request.schema]);
      return {
        columns: rows.slice(0, MAX_INTROSPECT_COLUMNS).map((row) => ({ table: String(row.table), name: String(row.name), type: String(row.type) })),
        truncated: rows.length > MAX_INTROSPECT_COLUMNS,
      };
    }
    case 'detail':
      return detail(query, request);
  }
}

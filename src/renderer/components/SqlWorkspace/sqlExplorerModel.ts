import type { SqlImportFormat } from '../../../shared/sqlWorkspace';

/** One column of a session table or view, with its DuckDB type. */
export interface SqlSchemaColumn {
  name: string;
  type: string;
}

/** One table or view of the Local engine. */
export interface SqlSchemaTable {
  /** Display name, schema-qualified outside DuckDB's `main`. */
  name: string;
  /** Raw identifier for generated SQL. Defaults to `name`. */
  sqlName?: string;
  /** Raw non-main schema identifier for generated SQL. */
  schemaName?: string;
  kind?: 'table' | 'view';
  columns?: ReadonlyArray<SqlSchemaColumn>;
  /** Rows DuckDB reports for a base table. */
  rowCount?: number;
  /** File format the table was imported from. */
  source?: SqlImportFormat;
}

export interface SqlSchemaMacro {
  schemaName: string;
  name: string;
}

/** What the Explorer lists under Local. */
export interface SqlCatalog {
  /** User tables and views, plus the Run Ledger's, which the editor can still complete. */
  tables: SqlSchemaTable[];
  macros: SqlSchemaMacro[];
  /** View names of information_schema, listed collapsed at the bottom. */
  systemViews: string[];
}

export const EMPTY_SQL_CATALOG: SqlCatalog = { tables: [], macros: [], systemViews: [] };

/** Run Ledger internals: queryable by name, not listed. */
const HIDDEN_EXPLORER_SCHEMAS: ReadonlySet<string> = new Set(['lingua_ledger']);

export interface SqlExplorerSchema {
  name: string;
  tables: SqlSchemaTable[];
  views: SqlSchemaTable[];
  macros: SqlSchemaMacro[];
}

const matches = (needle: string, value: string) =>
  needle.length === 0 || value.toLowerCase().includes(needle);

/**
 * Groups the catalog into schemas (`main` first) and applies the filter.
 * A schema with nothing left after filtering is dropped, except `main`
 * when nothing is filtered, so the empty state has a home.
 */
export function buildExplorerSchemas(catalog: SqlCatalog, filter: string): SqlExplorerSchema[] {
  const needle = filter.trim().toLowerCase();
  const bySchema = new Map<string, SqlExplorerSchema>();
  const schemaFor = (name: string) => {
    let entry = bySchema.get(name);
    if (!entry) {
      entry = { name, tables: [], views: [], macros: [] };
      bySchema.set(name, entry);
    }
    return entry;
  };
  if (needle.length === 0) schemaFor('main');
  for (const table of catalog.tables) {
    const schema = table.schemaName ?? 'main';
    if (HIDDEN_EXPLORER_SCHEMAS.has(schema)) continue;
    if (!matches(needle, table.sqlName ?? table.name)) continue;
    const entry = schemaFor(schema);
    (table.kind === 'view' ? entry.views : entry.tables).push(table);
  }
  for (const macro of catalog.macros) {
    if (HIDDEN_EXPLORER_SCHEMAS.has(macro.schemaName)) continue;
    if (!matches(needle, macro.name)) continue;
    schemaFor(macro.schemaName).macros.push(macro);
  }
  return [...bySchema.values()].sort((a, b) =>
    a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name.localeCompare(b.name)
  );
}

export function filterSystemViews(views: ReadonlyArray<string>, filter: string): string[] {
  const needle = filter.trim().toLowerCase();
  return views.filter(view => matches(needle, view));
}

/** Nodes open on first render: the Local root, `main` and its tables. */
export const DEFAULT_EXPANDED_NODES: ReadonlySet<string> = new Set([
  'local',
  'schema:main',
  'group:main:tables',
]);

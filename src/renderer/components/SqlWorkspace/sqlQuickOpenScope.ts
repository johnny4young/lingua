import type { SqlRemoteEngine } from '../../../shared/sqlConnections';
import type { SqlDbObjectKind } from '../../../shared/sqlDb';
import { quoteSqlTableReference } from '../../../shared/sqlQuote';
import type { SqlQueryV1 } from '../../../shared/sqlWorkspace';
import type { SqlObjectRef, SqlRemoteCatalog } from '../../stores/sqlRemoteCatalogStore';
import type { QuickOpenScopeItem } from '../../utils/quickOpenScope';
import type { SqlSchemaTable } from './sqlExplorerModel';
import type { SqlObjectTab } from './SqlObjectDetail';
import { QUERYABLE_KINDS } from './sqlRemoteTreeModel';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Kinds Quick Open lists; sequences and extensions stay in the Explorer. */
const LISTED: ReadonlySet<SqlDbObjectKind> = new Set(['table', 'view', 'matview', 'function', 'procedure']);
const HIDDEN_LOCAL_SCHEMAS: ReadonlySet<string> = new Set(['lingua_ledger']);

export interface SqlQuickOpenSources {
  t: Translate;
  localTables: ReadonlyArray<SqlSchemaTable>;
  queries: ReadonlyArray<SqlQueryV1>;
  catalogs: Readonly<Record<string, SqlRemoteCatalog>>;
  connection: (id: string) => { name: string; engine: SqlRemoteEngine } | undefined;
  showRemote: (connectionId: string, object: SqlObjectRef, tab: SqlObjectTab) => void;
  openLocal: (table: SqlSchemaTable) => void;
  openQuery: (id: string) => void;
  /** Puts text at the editor's cursor. */
  insert: (text: string) => void;
}

/** Tables, views and functions of every connection read so far and of Local, then saved queries. */
export function buildSqlQuickOpenItems(sources: SqlQuickOpenSources): QuickOpenScopeItem[] {
  const { t } = sources;
  const items: QuickOpenScopeItem[] = [];
  for (const [connectionId, catalog] of Object.entries(sources.catalogs)) {
    const connection = sources.connection(connectionId);
    if (!connection) continue;
    for (const [schema, level] of Object.entries(catalog.objects)) {
      if (level.status !== 'ready') continue;
      for (const object of level.value) {
        if (!LISTED.has(object.kind)) continue;
        const ref: SqlObjectRef = { schema, name: object.name, kind: object.kind, ...(object.signature !== undefined ? { signature: object.signature } : {}) };
        const queryable = QUERYABLE_KINDS.has(object.kind);
        items.push({
          id: `${connectionId}:${object.kind}:${schema}.${object.name}(${object.signature ?? ''})`,
          badge: t(`sqlWorkspace.remote.quickOpen.badge.${object.kind}`),
          name: `${schema}.${object.name}${object.signature !== undefined && !queryable ? `(${object.signature})` : ''}`,
          detail: connection.name,
          open: () => sources.showRemote(connectionId, ref, queryable ? 'data' : 'ddl'),
          structure: () => sources.showRemote(connectionId, ref, queryable ? 'columns' : 'ddl'),
          insert: () => sources.insert(queryable ? quoteSqlTableReference(object.name, schema, connection.engine) : object.name),
        });
      }
    }
  }
  const local = t('sqlWorkspace.connection.localName');
  for (const table of sources.localTables) {
    if (HIDDEN_LOCAL_SCHEMAS.has(table.schemaName ?? 'main')) continue;
    items.push({
      id: `local:${table.name}`,
      badge: t(`sqlWorkspace.remote.quickOpen.badge.${table.kind === 'view' ? 'view' : 'table'}`),
      name: table.name,
      detail: local,
      open: () => sources.openLocal(table),
      insert: () => sources.insert(quoteSqlTableReference(table.sqlName ?? table.name, table.schemaName)),
    });
  }
  for (const query of sources.queries) {
    if (query.kind === 'scratch') continue;
    items.push({
      id: `query:${query.id}`,
      badge: t('sqlWorkspace.remote.quickOpen.badge.query'),
      name: query.name,
      detail: query.folder !== undefined ? t('sqlWorkspace.remote.quickOpen.savedIn', { folder: query.folder }) : t('sqlWorkspace.remote.quickOpen.saved'),
      open: () => sources.openQuery(query.id),
    });
  }
  return items;
}

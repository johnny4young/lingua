import { useEffect, useMemo } from 'react';
import type { SqlSchemaTable } from '../components/SqlWorkspace/sqlExplorerModel';
import { QUERYABLE_KINDS } from '../components/SqlWorkspace/sqlRemoteTreeModel';
import { useSqlRemoteCatalogStore, type SqlRemoteColumn } from '../stores/sqlRemoteCatalogStore';

interface SqlRemoteCompletion {
  tables: SqlSchemaTable[];
  functions: string[];
}

const NONE: SqlRemoteCompletion = { tables: [], functions: [] };

/**
 * Tables, columns and functions of a connection for completion and Ask SQL,
 * from the levels read so far. The first schema is read even while the
 * Explorer is folded; its tables are named without the schema.
 */
export function useSqlRemoteCompletion(connectionId: string | undefined): SqlRemoteCompletion {
  const catalog = useSqlRemoteCatalogStore((state) => (connectionId ? state.catalogs[connectionId] : undefined));
  const generation = catalog?.generation ?? 0;
  const first = catalog?.schemas?.status === 'ready' ? catalog.schemas.value[0]?.name : undefined;

  useEffect(() => {
    if (connectionId) void useSqlRemoteCatalogStore.getState().loadSchemas(connectionId);
  }, [connectionId, generation]);
  useEffect(() => {
    if (!connectionId || first === undefined) return;
    const store = useSqlRemoteCatalogStore.getState();
    void store.loadObjects(connectionId, first);
    void store.loadColumns(connectionId, first);
  }, [connectionId, first, generation]);

  return useMemo(() => {
    if (!catalog) return NONE;
    const tables: SqlSchemaTable[] = [];
    const functions = new Set<string>();
    for (const [schema, level] of Object.entries(catalog.objects)) {
      if (level.status !== 'ready') continue;
      const columns = catalog.columns[schema];
      const byTable = new Map<string, SqlRemoteColumn[]>();
      if (columns?.status === 'ready') {
        for (const column of columns.value) byTable.set(column.table, [...(byTable.get(column.table) ?? []), column]);
      }
      for (const object of level.value) {
        if (QUERYABLE_KINDS.has(object.kind)) {
          tables.push({
            name: schema === first ? object.name : `${schema}.${object.name}`,
            sqlName: object.name,
            schemaName: schema,
            kind: object.kind === 'table' ? 'table' : 'view',
            ...(byTable.has(object.name) ? { columns: byTable.get(object.name)! } : {}),
          });
        } else if (object.kind === 'function') {
          functions.add(object.name);
        }
      }
    }
    return { tables, functions: [...functions] };
  }, [catalog, first]);
}

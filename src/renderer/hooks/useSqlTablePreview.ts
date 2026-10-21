import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SqlResponseV1 } from '../../shared/sqlWorkspace';
import type { SqlSchemaTable } from '../components/SqlWorkspace/sqlExplorerModel';
import type { SqlResultForeignKeys } from '../components/SqlWorkspace/SqlResultPreview';
import { buildSelectStarter } from '../components/SqlWorkspace/sqlResultFormatters';
import { executeQuery } from '../runtime/duckdbClient';
import {
  buildLookupSql,
  countReferences,
  loadTableForeignKeys,
  type SqlForeignKey,
  type SqlTableForeignKeys,
} from '../runtime/sqlForeignKeys';
import { toSqlResponse } from './useSqlRunner';

/** A table opened from the Explorer or a foreign-key link: its rows on screen, never a saved run. */
export interface SqlTablePreview {
  table: SqlSchemaTable;
  sql: string;
  response: SqlResponseV1;
  /** The preview a link was followed from, for the back chip. */
  back?: SqlTablePreview;
}

const keyCache = new Map<string, Promise<SqlTableForeignKeys>>();

/**
 * Table previews: open one from the Explorer, follow its foreign keys to the
 * referenced row and back, and open the rows that point at a row.
 */
export function useSqlTablePreview(timeoutMs: number, tables: ReadonlyArray<SqlSchemaTable>) {
  const [preview, setPreview] = useState<SqlTablePreview | null>(null);
  const [keys, setKeys] = useState<{ table: string; keys: SqlTableForeignKeys } | null>(null);
  // Bumped by every open, run and query switch so a late table result never lands over a newer view.
  const tokenRef = useRef(0);

  const show = useCallback((next: SqlTablePreview | null) => {
    tokenRef.current += 1;
    setPreview(next);
  }, []);

  const open = useCallback(
    async (table: SqlSchemaTable, sql?: string, back?: SqlTablePreview) => {
      const statement = sql ?? buildSelectStarter(table.sqlName ?? table.name, table.schemaName);
      tokenRef.current += 1;
      const token = tokenRef.current;
      const outcome = await executeQuery(statement, { timeoutMs });
      if (tokenRef.current !== token) return;
      setPreview({ table, sql: statement, response: toSqlResponse(outcome), ...(back ? { back } : {}) });
    },
    [timeoutMs]
  );

  const tableName = preview?.table.sqlName ?? preview?.table.name ?? null;
  const schemaName = preview?.table.schemaName ?? 'main';
  useEffect(() => {
    if (tableName === null) return;
    const cacheKey = `${schemaName}.${tableName}`;
    let live = true;
    if (!keyCache.has(cacheKey)) keyCache.set(cacheKey, loadTableForeignKeys(tableName, schemaName));
    void keyCache.get(cacheKey)!.then((loaded) => {
      if (live) setKeys({ table: cacheKey, keys: loaded });
    });
    return () => {
      live = false;
    };
  }, [tableName, schemaName]);

  const tableFor = useCallback(
    (name: string, schema: string): SqlSchemaTable =>
      tables.find((t) => (t.sqlName ?? t.name) === name && (t.schemaName ?? 'main') === schema) ?? {
        name: schema === 'main' ? name : `${schema}.${name}`,
        sqlName: name,
        ...(schema === 'main' ? {} : { schemaName: schema }),
      },
    [tables]
  );

  const foreignKeys = useMemo<SqlResultForeignKeys | undefined>(() => {
    if (!preview || !keys || keys.table !== `${schemaName}.${tableName}`) return undefined;
    if (keys.keys.outgoing.length === 0 && keys.keys.incoming.length === 0) return undefined;
    return {
      outgoing: keys.keys.outgoing,
      incoming: keys.keys.incoming,
      // The referenced table shares the schema of the one that declares the key.
      onFollow: (key: SqlForeignKey, value: unknown) =>
        void open(tableFor(key.refTable, key.schema), buildLookupSql(key.refTable, key.schema, key.refColumn, value), preview),
      onOpenReference: (key: SqlForeignKey, value: unknown) =>
        void open(tableFor(key.table, key.schema), buildLookupSql(key.table, key.schema, key.column, value), preview),
      countReferences,
    };
  }, [preview, keys, schemaName, tableName, open, tableFor]);

  /** Forgets cached keys after the schema may have changed. */
  const invalidate = useCallback(() => keyCache.clear(), []);

  return { preview, show, open, foreignKeys, invalidate };
}

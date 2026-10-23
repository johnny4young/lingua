import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SqlResponseV1 } from '../../shared/sqlWorkspace';
import type { SqlSchemaTable } from '../components/SqlWorkspace/sqlExplorerModel';
import type { SqlResultForeignKeys } from '../components/SqlWorkspace/SqlResultPreview';
import { buildSelectStarter } from '../components/SqlWorkspace/sqlResultFormatters';
import type { SqlRemoteEngine } from '../../shared/sqlConnections';
import { executeQuery } from '../runtime/duckdbClient';
import { executeRemoteScript, sqlDbBridge } from '../runtime/sqlRemote';
import {
  buildLookupSql,
  countReferences,
  loadTableForeignKeys,
  type SqlForeignKey,
  type SqlTableForeignKeys,
} from '../runtime/sqlForeignKeys';
import { toSqlResponse } from './useSqlRunner';
import { ROW_EDIT_ENGINES, type RowEditTable } from '../../shared/sqlRowEdits';
import { loadLocalEditTable } from '../runtime/sqlLocalEdits';
import { findConnection } from '../stores/sqlConnectionsStore';
import { useSettingsStore } from '../stores/settingsStore';

/** Whether the opened table's rows can be edited: its target, or why not. */
export type SqlTableEdit = { table: RowEditTable } | { reason: 'view' | 'no-key' | 'read-only' | 'production' | 'engine' };

/** A table opened from the Explorer or a foreign-key link: its rows on screen, never a saved run. */
export interface SqlTablePreview {
  table: SqlSchemaTable;
  sql: string;
  response: SqlResponseV1;
  /** The preview a link was followed from, for the back chip. */
  back?: SqlTablePreview;
  /** Set when the rows come from a database connection rather than Local. */
  connectionId?: string;
  /** Set when Edit table rows is on. */
  edit?: SqlTableEdit;
}

/** The edit target of a connection's table, from its own catalog read; main checks the key again on commit. None when that read fails. */
async function remoteEdit(table: SqlSchemaTable, remote: SqlRemoteTableTarget): Promise<SqlTableEdit | undefined> {
  const connection = findConnection(remote.connectionId);
  if (connection?.readOnly) return { reason: 'read-only' };
  if (connection?.env === 'prod') return { reason: 'production' };
  if (!ROW_EDIT_ENGINES.has(remote.engine)) return { reason: 'engine' };
  if (table.kind && table.kind !== 'table') return { reason: 'view' };
  const name = table.sqlName ?? table.name;
  const schema = table.schemaName ?? '';
  const read = await sqlDbBridge()?.introspect(remote.connectionId, { level: 'detail', schema, name, kind: 'table' });
  if (!read?.detail) return undefined;
  const columns = read.detail.columns;
  const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name);
  if (primaryKey.length === 0) return { reason: 'no-key' };
  return { table: { engine: remote.engine, schema, name, columns: columns.map((column) => column.name), key: { kind: 'pk', columns: primaryKey } } };
}

/** A keyless Local table is edited by rowid, so the rows on screen must carry it. */
const withRowid = (statement: string) => statement.replace(/^SELECT \* FROM/i, 'SELECT rowid, * FROM');

export interface SqlRemoteTableTarget {
  connectionId: string;
  engine: SqlRemoteEngine;
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
    async (table: SqlSchemaTable, sql?: string, back?: SqlTablePreview, remote?: SqlRemoteTableTarget) => {
      let statement = sql ?? buildSelectStarter(table.sqlName ?? table.name, table.schemaName, remote?.engine);
      tokenRef.current += 1;
      const token = tokenRef.current;
      const db = remote ? sqlDbBridge() : null;
      // A connection's SQL never falls back to Local.
      if (remote && !db) return;
      let edit: SqlTableEdit | undefined;
      let remoteTarget: Promise<SqlTableEdit | undefined> | undefined;
      if (useSettingsStore.getState().featureFlags.editRows === true) {
        // A connection's key read runs beside its data read; a Local one decides the SELECT, so it goes first.
        if (remote) remoteTarget = remoteEdit(table, remote).catch(() => undefined);
        else {
          const local = await loadLocalEditTable(table.sqlName ?? table.name, table.schemaName ?? 'main');
          if (local === 'view') edit = { reason: 'view' };
          else if (local) {
            edit = { table: local };
            if (local.key.kind === 'rowid') statement = withRowid(statement);
          }
        }
      }
      const outcome = remote && db ? (await executeRemoteScript(db, remote.connectionId, [statement], { timeoutMs }))[0] : await executeQuery(statement, { timeoutMs });
      if (remoteTarget) edit = await remoteTarget;
      if (tokenRef.current !== token || !outcome) return;
      setPreview({
        table,
        sql: statement,
        response: toSqlResponse(outcome),
        ...(back ? { back } : {}),
        ...(remote ? { connectionId: remote.connectionId } : {}),
        ...(edit ? { edit } : {}),
      });
    },
    [timeoutMs]
  );

  // Foreign keys are read from Local's catalog; a connection's keys show in its object detail.
  const tableName = preview && !preview.connectionId ? (preview.table.sqlName ?? preview.table.name) : null;
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

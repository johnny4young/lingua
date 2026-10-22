/**
 * The SQL panel's database connections: the active one, the picker and the
 * connection sheet, the catalog tree in the Explorer, objects in the results
 * area, completion tables, the password the catalog may wait for, and the
 * Quick Open rows of the tab.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlDbConnectionView, SqlDbSecretKind } from '../../shared/sqlDb';
import type { SqlQueryV1 } from '../../shared/sqlWorkspace';
import { SqlPasswordPrompt } from '../components/SqlWorkspace/SqlConnectionDialogs';
import { SqlConnectionManager } from '../components/SqlWorkspace/SqlConnectionManager';
import { SqlConnectionSheet, type SqlConnectionSheetMode } from '../components/SqlWorkspace/SqlConnectionSheet';
import { SqlObjectDetail } from '../components/SqlWorkspace/SqlObjectDetail';
import { buildSelectStarter } from '../components/SqlWorkspace/sqlResultFormatters';
import type { SqlSchemaTable } from '../components/SqlWorkspace/sqlExplorerModel';
import type { SqlObjectTab } from '../components/SqlWorkspace/SqlObjectDetail';
import { buildSqlQuickOpenItems, type SqlQuickOpenSources } from '../components/SqlWorkspace/sqlQuickOpenScope';
import { SqlRemoteTree } from '../components/SqlWorkspace/SqlRemoteTree';
import { QUERYABLE_KINDS } from '../components/SqlWorkspace/sqlRemoteTreeModel';
import { resolveShortcutDisplayPlatform } from '../data/keyboardShortcuts';
import { sqlDbBridge } from '../runtime/sqlRemote';
import { useProjectStore } from '../stores/projectStore';
import { findConnection, keepsAskedSecret, useSqlConnectionsStore } from '../stores/sqlConnectionsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSqlRemoteCatalogStore, type SqlObjectRef } from '../stores/sqlRemoteCatalogStore';
import { useWorkspaceSqlStore } from '../stores/workspaceSqlStore';
import { setQuickOpenScope } from '../utils/quickOpenScope';
import { useSqlRemoteCompletion } from './useSqlRemoteCompletion';
import type { useSqlTablePreview } from './useSqlTablePreview';

export interface SqlObjectView {
  connectionId: string;
  object: SqlObjectRef;
  tab: SqlObjectTab;
}

interface Options {
  activeQuery: SqlQueryV1 | undefined;
  objectView: SqlObjectView | null;
  setObjectView: Dispatch<SetStateAction<SqlObjectView | null>>;
  tables: ReturnType<typeof useSqlTablePreview>;
  localTables: SqlSchemaTable[];
  queries: ReadonlyArray<SqlQueryV1>;
  explorerFilter: string;
  createQuery: (sql?: string, name?: string, connectionId?: string) => void;
  selectQuery: (id: string) => void;
  insertAtCursor: (text: string) => void;
  /** Takes SQL into the editor, as Edit in editor does. */
  insertSql: (sql: string) => void;
}

export function useSqlConnectionObjects({
  activeQuery,
  objectView,
  setObjectView,
  tables,
  localTables,
  queries,
  explorerFilter,
  createQuery,
  selectQuery,
  insertAtCursor,
  insertSql,
}: Options) {
  const { t } = useTranslation();
  // Labs: desktop runs connections; web lists Local and says why.
  const dbFlag = useSettingsStore((state) => state.featureFlags.dbClient === true);
  const dbDesktop = sqlDbBridge() !== null;
  const catalog = useSqlConnectionsStore((state) => state.catalog);
  const [connectionSheet, setConnectionSheet] = useState<SqlConnectionSheetMode | null>(null);
  // The manager stays open under the sheet it opened, and shows again when the sheet closes.
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerQuery, setManagerQuery] = useState('');
  const project = useProjectStore((state) => state.currentProject);
  useEffect(() => {
    if (dbFlag && dbDesktop) void useSqlConnectionsStore.getState().refresh();
  }, [dbFlag, dbDesktop]);
  const listed = (id: string | undefined): SqlDbConnectionView | undefined =>
    id ? [...(catalog?.connections ?? []), ...(catalog?.adhoc ?? [])].find((entry) => entry.id === id) : undefined;
  const activeConnection = dbFlag ? listed(activeQuery?.connectionId) : undefined;
  const selectConnection = useCallback(
    (connectionId: string | undefined) => {
      let id = useWorkspaceSqlStore.getState().activeQueryId;
      if (!id) {
        createQuery();
        id = useWorkspaceSqlStore.getState().activeQueryId;
      }
      if (id) useWorkspaceSqlStore.getState().updateQuery(id, { connectionId });
    },
    [createQuery]
  );
  const [catalogPassword, setCatalogPassword] = useState<{ connectionId: string; kind: SqlDbSecretKind; refused: boolean } | null>(null);
  const setCatalogPasswordFor = (connectionId: string, kind: SqlDbSecretKind) => setCatalogPassword({ connectionId, kind, refused: false });
  const completion = useSqlRemoteCompletion(activeConnection?.id);
  const loading = useSqlRemoteCatalogStore(
    (state) => activeConnection !== undefined && state.catalogs[activeConnection.id]?.schemas?.status === 'loading'
  );
  const { show: showTablePreview } = tables;

  // Another connection's object or rows never stay on screen.
  const activeConnectionId = activeConnection?.id;
  useEffect(() => {
    setObjectView((view) => (view && view.connectionId !== activeConnectionId ? null : view));
    const preview = tables.preview;
    if (preview?.connectionId && preview.connectionId !== activeConnectionId) showTablePreview(null);
    // Only a connection switch clears the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  const showObject = useCallback(
    (connectionId: string, object: SqlObjectRef, tab: SqlObjectTab) => {
      setObjectView({ connectionId, object, tab });
      const connection = findConnection(connectionId);
      if (tab === 'data' && connection && QUERYABLE_KINDS.has(object.kind)) {
        const table = { name: `${object.schema}.${object.name}`, sqlName: object.name, schemaName: object.schema };
        void tables.open(table, undefined, undefined, { connectionId, engine: connection.engine });
      } else {
        showTablePreview(null);
      }
    },
    [tables, showTablePreview, setObjectView]
  );

  /** A password typed for a run also unblocks a catalog that was waiting for it. */
  const retryCatalogAfterPassword = useCallback((connectionId: string) => {
    const level = useSqlRemoteCatalogStore.getState().catalogs[connectionId]?.schemas;
    if (level?.status === 'error' && level.passwordNeeded) useSqlRemoteCatalogStore.getState().refresh(connectionId);
  }, []);

  // Quick Open on this tab lists the catalog's objects and the saved queries first.
  const quickOpenRef = useRef<Omit<SqlQuickOpenSources, 't' | 'catalogs'> | null>(null);
  useEffect(() => {
    quickOpenRef.current = {
      localTables,
      queries,
      connection: (id) => (dbFlag ? findConnection(id) : undefined),
      showRemote: (connectionId, object, tab) => {
        const store = useWorkspaceSqlStore.getState();
        if (store.queries.find((q) => q.id === store.activeQueryId)?.connectionId !== connectionId) {
          // Another connection's object opens in a new query on that connection.
          const before = store.activeQueryId;
          createQuery('', '', connectionId);
          // The Free tab budget can refuse the new query.
          if (useWorkspaceSqlStore.getState().activeQueryId === before) return;
        }
        showObject(connectionId, object, tab);
      },
      openLocal: (table) => {
        setObjectView(null);
        void tables.open(table);
      },
      openQuery: selectQuery,
      insert: insertAtCursor,
    };
  });
  useEffect(() => {
    const mac = resolveShortcutDisplayPlatform(window.lingua?.platform ?? 'web', navigator.platform) === 'darwin';
    return setQuickOpenScope({
      title: t('sqlWorkspace.remote.quickOpen.title'),
      legend: [
        [mac ? '↵' : 'Enter', t('sqlWorkspace.remote.quickOpen.openData')],
        [mac ? '⌘↵' : 'Ctrl+Enter', t('sqlWorkspace.remote.quickOpen.structure')],
        [mac ? '⌥↵' : 'Alt+Enter', t('sqlWorkspace.remote.quickOpen.insertName')],
      ],
      note: t('sqlWorkspace.remote.quickOpen.note'),
      countLabel: (count) => t('sqlWorkspace.remote.quickOpen.count', { count }),
      items: () =>
        quickOpenRef.current
          ? buildSqlQuickOpenItems({ t, catalogs: useSqlRemoteCatalogStore.getState().catalogs, ...quickOpenRef.current })
          : [],
    });
  }, [t]);

  const renderRemoteTree = activeConnection
    ? (collapseSignal: number) => (
        <SqlRemoteTree
          key={activeConnection.id}
          connection={activeConnection}
          filter={explorerFilter}
          selected={objectView?.connectionId === activeConnection.id ? objectView.object : null}
          onOpenObject={(object) => showObject(activeConnection.id, object, QUERYABLE_KINDS.has(object.kind) ? 'columns' : 'ddl')}
          onEnterPassword={(kind) => setCatalogPasswordFor(activeConnection.id, kind)}
          collapseSignal={collapseSignal}
        />
      )
    : undefined;

  const connectionLabel = dbFlag
    ? (id: string | undefined) => {
        if (!id) return t('sqlWorkspace.connection.localName');
        const connection = findConnection(id);
        if (!connection) return t('sqlWorkspace.remote.missingConnection');
        return connection.readOnly ? t('sqlWorkspace.remote.readOnlyName', { name: connection.name }) : connection.name;
      }
    : undefined;

  // Stays open and says so when the server refuses the password.
  const catalogPasswordPrompt = catalogPassword ? (
    <SqlPasswordPrompt
      name={findConnection(catalogPassword.connectionId)?.name ?? ''}
      refused={catalogPassword.refused}
      kind={catalogPassword.kind}
      keepsInKeychain={keepsAskedSecret(catalogPassword.connectionId, catalogPassword.kind)}
      onSubmit={(password) => {
        const { connectionId, kind } = catalogPassword;
        void (async () => {
          await sqlDbBridge()?.sessionPassword(connectionId, password, kind);
          const store = useSqlRemoteCatalogStore.getState();
          store.refresh(connectionId);
          await store.loadSchemas(connectionId);
          const level = useSqlRemoteCatalogStore.getState().catalogs[connectionId]?.schemas;
          setCatalogPassword(level?.status === 'error' && level.passwordNeeded ? { connectionId, kind: level.passwordNeeded, refused: true } : null);
        })();
      }}
      onCancel={() => setCatalogPassword(null)}
    />
  ) : null;

  const barRemote = dbFlag
    ? {
        desktop: dbDesktop,
        catalog,
        activeId: activeQuery?.connectionId,
        onSelect: selectConnection,
        onNew: () => setConnectionSheet({ kind: 'new' }),
        onOpenUrl: () => setConnectionSheet({ kind: 'url' }),
        onEdit: (id: string) => {
          const connection = listed(id);
          if (connection) setConnectionSheet({ kind: 'edit', connection });
        },
        onManage: () => setManagerOpen(true),
      }
    : undefined;

  const connectionSheetElement = connectionSheet ? (
    <SqlConnectionSheet
      mode={connectionSheet}
      onClose={() => setConnectionSheet(null)}
      onDone={(connection) => {
        setConnectionSheet(null);
        if (!managerOpen) selectConnection(connection.id);
      }}
    />
  ) : managerOpen ? (
    <SqlConnectionManager
      project={project ? { rootId: project.rootId, name: project.name } : null}
      query={managerQuery}
      onQuery={setManagerQuery}
      onClose={() => setManagerOpen(false)}
      onNew={() => setConnectionSheet({ kind: 'new' })}
      onEdit={(connection) => setConnectionSheet({ kind: 'edit', connection })}
    />
  ) : null;

  /** The active connection's object, with `data` as its Data tab once its rows are in; `data` alone otherwise. */
  const preview = tables.preview;
  const renderObjectDetail = (data: ReactNode) =>
    objectView && activeConnection ? (
      <SqlObjectDetail
        connectionId={objectView.connectionId}
        object={objectView.object}
        tab={objectView.tab}
        onTab={(tab) => showObject(objectView.connectionId, objectView.object, tab)}
        onInsertSelect={() => insertSql(buildSelectStarter(objectView.object.name, objectView.object.schema, activeConnection.engine))}
        onEnterPassword={(kind) => setCatalogPasswordFor(objectView.connectionId, kind)}
        data={
          preview?.connectionId === objectView.connectionId && preview.table.name === `${objectView.object.schema}.${objectView.object.name}` ? (
            data
          ) : (
            <p data-testid="sql-object-data-loading" className="px-4 py-3 text-caption text-fg-subtle">
              {t('sqlWorkspace.remote.loading')}
            </p>
          )
        }
      />
    ) : (
      data
    );

  return {
    dbFlag,
    activeConnection,
    barRemote,
    connectionSheetElement,
    renderObjectDetail,
    refreshCatalog: () => {
      if (activeConnection) useSqlRemoteCatalogStore.getState().refresh(activeConnection.id);
    },
    editorTables: activeConnection ? completion.tables : localTables,
    functions: completion.functions,
    loading,
    retryCatalogAfterPassword,
    renderRemoteTree,
    connectionLabel,
    catalogPasswordPrompt,
  };
}

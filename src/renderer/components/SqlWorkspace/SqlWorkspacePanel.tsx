/**
 * Root of the SQL workspace tab. Local (DuckDB) is the connection in the
 * bar on top; below it the Explorer (or its 44 px rail, Cmd/Ctrl+B) sits
 * beside the query tabs and editor, with the results under the editor.
 *
 * Runs go through `useSqlRunner`; query tabs share the Free tab budget
 * (`admitSqlQueryTab`). A single DuckDB engine is shared per session;
 * connections open per call.
 */

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import type { SqlQueryV1, SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { buildSampleTable } from '../../../shared/sqlSampleTable';
import { splitSqlStatements } from '../../../shared/sqlStatements';
import {
  executeQuery,
  getDuckDbEngine,
  configureDuckDbPersistence,
  getResolvedSqlStorageMode,
  getResolvedSqlStorageRequestMode,
  flushAndReleaseDuckDbEngine,
  estimateOriginStorageBytes,
  type DuckDbEngineHandle,
} from '../../runtime/duckdbClient';
import { loadSqlCatalog } from '../../runtime/sqlExplorerCatalog';
import { profileSqlQuery } from '../../runtime/sqlColumnProfile';
import { trackSqlProfileOpened, trackSqlStorageMode } from '../../hooks/sqlWorkspaceTelemetry';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import { moreRowsKey, sessionRunSources, useSqlRunner } from '../../hooks/useSqlRunner';
import { useSqlTablePreview } from '../../hooks/useSqlTablePreview';
import { useSqlQueryTabActions } from '../../hooks/useSqlQueryTabActions';
import { useSqlImport } from '../../hooks/useSqlImport';
import { useSqlResultHandoffs } from '../../hooks/useSqlResultHandoffs';
import type { SqlImportSource } from '../../hooks/sqlWorkspaceTelemetry';
import { SqlEmptyState } from './SqlEmptyState';
import { SqlQueryList } from './SqlQueryList';
import { SqlQueryEditor } from './SqlQueryEditor';
import { SqlResultPreview, type SqlResultSource } from './SqlResultPreview';
import { AskSqlButton } from './AskSqlButton';
import { SqlExplorer } from './SqlExplorer';
import { SqlExplorerRail } from './SqlExplorerRail';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SqlConnectionBar } from './SqlConnectionBar';
import { SqlImportButton } from './SqlImportButton';
import { EMPTY_SQL_CATALOG, type SqlCatalog, type SqlSchemaTable } from './sqlExplorerModel';
import { SqlImportPreviewModal } from './SqlImportPreviewModal';
import { SqlQueryTabs } from './SqlQueryTabs';
import { SqlSaveQueryPopover } from './SqlSaveQueryPopover';
import { ENGINE_LABEL } from './sqlConnectionStyle';
import { SqlHistorySection } from './SqlHistorySection';
import { SqlPlanView } from './SqlPlanView';
import { SqlResultTabs, SqlRunMessages, SqlStuckQueryBand } from './SqlRunOutput';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SqlPasswordPrompt, SqlProdBanner, SqlWriteConfirmDialog } from './SqlConnectionDialogs';
import { useSqlRemoteCatalogStore } from '../../stores/sqlRemoteCatalogStore';
import { findConnection, keepsAskedSecret } from '../../stores/sqlConnectionsStore';
import { useSqlRowEdits } from '../../hooks/useSqlRowEdits';
import { useSqlConnectionObjects, type SqlObjectView } from '../../hooks/useSqlConnectionObjects';
import { formatByteSize } from '../../i18n/formatNumber';
import { sqlDialect } from '../../../shared/sqlDialect';

/** Origin-wide usage, hence approximate (`~5 MB`). */
const formatApproxStorage = (bytes: number) => `~${formatByteSize(bytes)}`;

export interface SqlWorkspacePanelProps {
  /**
   * The stable workspace tab id. The SQL surface is one collection tab, so
   * the panel binds to the store's `activeQueryId`, not to this id.
   */
  tabId?: string;
}

export function SqlWorkspacePanel(_props: SqlWorkspacePanelProps = {}) {
  const { t } = useTranslation();
  const tier = useEffectiveTier();
  const sidebarLayout = useDefaultLayout({
    id: 'lingua-sql-workspace-sidebar-layout',
    panelIds: ['sql-explorer-pane', 'sql-main-pane'],
    storage: localStorage,
  });
  const mainLayout = useDefaultLayout({
    id: 'lingua-sql-workspace-editor-results-layout',
    panelIds: ['sql-editor-pane', 'sql-results-pane'],
    storage: localStorage,
  });
  const queries = useWorkspaceSqlStore((state) => state.queries);
  const activeQueryId = useWorkspaceSqlStore((state) => state.activeQueryId);
  const explorerFolded = useWorkspaceSqlStore((state) => state.explorerFolded);
  const tableSources = useWorkspaceSqlStore((state) => state.tableSources);
  const openQueryIds = useWorkspaceSqlStore((state) => state.openQueryIds);
  const history = useWorkspaceSqlStore((state) => state.history);

  // The editor is never blank while a query tab is open.
  useEffect(() => {
    const store = useWorkspaceSqlStore.getState();
    if (store.activeQueryId !== null && store.openQueryIds.includes(store.activeQueryId)) return;
    const first = store.openQueryIds[0];
    if (first) store.setActiveQuery(first);
    else if (store.activeQueryId !== null) store.setActiveQuery(null);
  }, [openQueryIds, activeQueryId]);
  const responsesByQueryId = useWorkspaceSqlStore((state) => state.responsesByQueryId);
  const rowDisplayLimit = useSettingsStore((state) => state.sqlWorkspaceRowDisplayLimit);
  const queryTimeoutMs = useSettingsStore((state) => state.sqlWorkspaceQueryTimeoutMs);
  // Applied to the engine on mount, before the eager load.
  const persistTables = useSettingsStore((state) => state.sqlWorkspacePersistTables);

  // The resolved backing lives in the store so Settings "Reconnect now" keeps the label live.
  const storageMode = useWorkspaceSqlStore((state) => state.storageMode);
  const storageRequestedMode = useWorkspaceSqlStore((state) => state.storageRequestedMode);
  const [storageUsageLabel, setStorageUsageLabel] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<SqlCatalog>(EMPTY_SQL_CATALOG);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [explorerFilter, setExplorerFilter] = useState('');
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [isCreatingSample, setIsCreatingSample] = useState(false);
  // Lets the run handler refresh the Explorer without a forward dependency.
  const refreshTablesRef = useRef<() => void>(() => {});
  const [selectedResponseIndex, setSelectedResponseIndex] = useState(0);
  // The nonce makes the editor append even when the text repeats.
  const [insertSignal, setInsertSignal] = useState<{ text: string; nonce: number } | null>(null);
  const [predicateSignal, setPredicateSignal] = useState<{ text: string; nonce: number; raw?: boolean } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // A connection's object in the results area, and the connection whose catalog waits for a password.
  const [objectView, setObjectView] = useState<SqlObjectView | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);

  const schemaTables = useMemo<SqlSchemaTable[]>(
    () =>
      catalog.tables.map((table) => {
        const format = tableSources[table.name];
        return format ? { ...table, source: format } : table;
      }),
    [catalog.tables, tableSources]
  );
  const explorerCatalog = useMemo(() => ({ ...catalog, tables: schemaTables }), [catalog, schemaTables]);
  const tables = useSqlTablePreview(queryTimeoutMs, schemaTables);
  const { preview: tablePreview, show: showTablePreview } = tables;
  // After a commit the table is read again, from the same SQL, so its rows show what the database holds.
  const rowEdits = useSqlRowEdits(tablePreview, (shown) => {
    const engine = shown.connectionId ? findConnection(shown.connectionId)?.engine : undefined;
    void tables.open(shown.table, shown.sql, shown.back, shown.connectionId && engine ? { connectionId: shown.connectionId, engine } : undefined);
  });

  const activeQuery: SqlQueryV1 | undefined = useMemo(
    () => queries.find((q) => q.id === activeQueryId),
    [queries, activeQueryId]
  );
  const openQueries = useMemo(
    () =>
      openQueryIds
        .map((id) => queries.find((q) => q.id === id))
        .filter((q): q is SqlQueryV1 => q !== undefined),
    [openQueryIds, queries]
  );
  const folders = useMemo(
    () => [...new Set(queries.flatMap((q) => (q.folder !== undefined ? [q.folder] : [])))].sort(),
    [queries]
  );
  const activeResponses: ReadonlyArray<SqlResponseV1> = activeQuery
    ? (responsesByQueryId[activeQuery.id] ?? [])
    : [];
  // Clamped so a shrinking history never points past the end.
  const safeResponseIndex =
    activeResponses.length === 0 ? 0 : Math.min(selectedResponseIndex, activeResponses.length - 1);
  const activeResponse: SqlResponseV1 | null = activeResponses[safeResponseIndex] ?? null;
  const profileSource =
    activeQuery !== undefined && activeResponse !== null && safeResponseIndex === 0
      ? sessionRunSources.get(activeQuery.id)
      : undefined;
  const editorSourceSql =
    profileSource !== undefined && profileSource.recordedAt === activeResponse?.recordedAt
      ? profileSource.query
      : undefined;

  const shownResponse = tablePreview?.response ?? activeResponse;
  const resultSource = useMemo<SqlResultSource | undefined>(() => {
    if (tablePreview) {
      return {
        origin: 'table',
        sql: tablePreview.sql,
        tableName: tablePreview.table.name,
        ...(tablePreview.back ? { backTo: tablePreview.back.table.name } : {}),
      };
    }
    return editorSourceSql !== undefined ? { origin: 'editor', sql: editorSourceSql } : undefined;
  }, [tablePreview, editorSourceSql]);

  const resetView = useCallback(() => {
    setSelectedResponseIndex(0);
    setObjectView(null);
    showTablePreview(null);
  }, [showTablePreview]);
  const tabActions = useSqlQueryTabActions(resetView);
  const { create: handleCreate, select: handleSelect, saveDialog } = tabActions;

  const handleEditInEditor = useCallback(
    (sql: string) => {
      showTablePreview(null);
      if (useWorkspaceSqlStore.getState().activeQueryId === null) {
        handleCreate(sql);
        return;
      }
      setInsertSignal((prev) => ({ text: sql, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [handleCreate, showTablePreview]
  );

  const handleSelectResponse = useCallback((index: number) => {
    setSelectedResponseIndex(index);
  }, []);

  // Patch the query the editor names, not a closed-over one that may have switched mid-debounce.
  const handlePatch = useCallback((queryId: string, patch: Partial<SqlQueryV1>) => {
    useWorkspaceSqlStore.getState().updateQuery(queryId, patch);
  }, []);

  const handleBeforeRun = useCallback(() => {
    showTablePreview(null);
    setObjectView(null);
    setSelectedResponseIndex(0);
  }, [showTablePreview]);
  const handleSchemaChanged = useCallback((connectionId?: string) => {
    if (connectionId) useSqlRemoteCatalogStore.getState().refresh(connectionId);
    else refreshTablesRef.current();
  }, []);
  const runner = useSqlRunner({
    timeoutMs: queryTimeoutMs,
    onBeforeRun: handleBeforeRun,
    onSchemaChanged: handleSchemaChanged,
  });
  const runWhole = useCallback(
    (query: SqlQueryV1) =>
      void runner.run({
        query,
        mode: 'all',
        statements: splitSqlStatements(query.query).map((statement) => statement.text),
      }),
    [runner]
  );

  // A profile is secondary exploration, not a run: no response, history or ledger entry.
  const handleProfileQuery = useCallback(
    async (query: string) => {
      trackSqlProfileOpened();
      return profileSqlQuery(query, { timeoutMs: queryTimeoutMs });
    },
    [queryTimeoutMs]
  );

  // Apply-&-re-run: run the fresh store object, not the closed-over query.
  const handleApplyFix = useCallback(
    (sql: string) => {
      const store = useWorkspaceSqlStore.getState();
      const id = store.activeQueryId;
      if (id === null) return;
      store.updateQuery(id, { query: sql });
      const updated = useWorkspaceSqlStore.getState().queries.find((q) => q.id === id);
      if (updated) runWhole(updated);
    },
    [runWhole]
  );

  const handleRefreshTables = useCallback(async () => {
    setIsLoadingTables(true);
    let engine: DuckDbEngineHandle;
    let connection;
    try {
      engine = await getDuckDbEngine();
      connection = await engine.connect();
    } catch (err) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.response.engineLoadFailedBand',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
      setIsLoadingTables(false);
      setCatalogLoaded(true);
      return;
    }
    try {
      const next = await loadSqlCatalog(connection);
      setCatalog(next);
      useWorkspaceSqlStore.getState().pruneTableSources(next.tables.map((table) => table.name));
    } catch (err) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.response.errorBand',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
    } finally {
      try {
        await connection.close();
      } catch {
        /* defensive */
      }
      setIsLoadingTables(false);
      setCatalogLoaded(true);
    }
  }, []);

  const invalidateForeignKeys = tables.invalidate;
  useEffect(() => {
    refreshTablesRef.current = () => {
      invalidateForeignKeys();
      void handleRefreshTables();
    };
  }, [handleRefreshTables, invalidateForeignKeys]);

  const existingTableNames = useMemo(() => schemaTables.map((table) => table.name), [schemaTables]);
  const sqlImport = useSqlImport({
    existingTableNames,
    tables: schemaTables,
    onImported: ({ tableName, format, created }) => {
      if (created) useWorkspaceSqlStore.getState().setTableSource(tableName, format);
      void handleRefreshTables();
    },
  });
  const importBusy = sqlImport.isPreviewing || sqlImport.isImporting || sqlImport.modal !== null;

  const handleStartImport = useCallback(
    (file: File, source: SqlImportSource) => {
      void sqlImport.startImport(file, source);
    },
    [sqlImport]
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handlePickImport = useCallback(() => importInputRef.current?.click(), []);

  // Creates `cities` (or `cities_2`…) and opens a ready-to-run SELECT; it does not run it.
  const handleTrySample = useCallback(async () => {
    setIsCreatingSample(true);
    try {
      const sample = buildSampleTable(existingTableNames);
      const outcome = await executeQuery(sample.createSql, { timeoutMs: queryTimeoutMs });
      if (outcome.status !== 'success') {
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.sample.failed',
          detail: outcome.errorMessage ?? outcome.status,
        });
        return;
      }
      handleCreate(sample.selectSql, t('sqlWorkspace.sample.queryName', { name: sample.tableName }));
      await handleRefreshTables();
    } finally {
      setIsCreatingSample(false);
    }
  }, [existingTableNames, handleCreate, handleRefreshTables, queryTimeoutMs, t]);

  const handoffs = useSqlResultHandoffs({
    response: shownResponse,
    source: safeResponseIndex === 0 || tablePreview ? resultSource : undefined,
    query: tablePreview ? undefined : activeQuery,
    existingTableNames,
    timeoutMs: queryTimeoutMs,
    onTableCreated: () => refreshTablesRef.current(),
  });

  // Stash the query in the snippet library; `addSnippet` enforces the Free ceiling.
  const handleSaveSnippet = useCallback(
    (query: SqlQueryV1) => {
      const label =
        query.name.trim().length > 0 ? query.name.trim() : t('sqlWorkspace.snippet.defaultLabel');
      const id = useSnippetsStore.getState().addSnippet({
        language: 'sql',
        label,
        description: t('sqlWorkspace.snippet.description'),
        code: query.query,
      });
      if (id !== null) {
        useUIStore.getState().pushStatusNotice({
          tone: 'success',
          messageKey: 'sqlWorkspace.snippet.saved',
        });
      }
    },
    [t]
  );

  // Load DuckDB in the background on first mount so the first Run is not a cold boot.
  // `persistTables` is read once here; a change applies on reload or "Reconnect now".
  useEffect(() => {
    configureDuckDbPersistence(persistTables);
    let cancelled = false;
    void getDuckDbEngine()
      .then(() => {
        if (cancelled) return;
        const resolved = getResolvedSqlStorageMode();
        const requested = getResolvedSqlStorageRequestMode();
        useWorkspaceSqlStore.getState().setStorageMode(resolved, requested);
        trackSqlStorageMode(resolved, requested);
        if (requested === 'opfs' && resolved === 'memory') {
          useUIStore.getState().pushStatusNotice({
            tone: 'warning',
            messageKey: 'sqlWorkspace.storage.unavailableNotice',
          });
        }
        // With OPFS persistence, tables from a previous session exist before any refresh.
        refreshTablesRef.current();
      })
      .catch(() => {
        // The Run path surfaces engine failures; the Explorer stops waiting for a catalog.
        setCatalogLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // Mount-once: the engine is a session singleton.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (storageMode !== 'opfs') return;
    let cancelled = false;
    void estimateOriginStorageBytes().then((bytes) => {
      if (!cancelled) setStorageUsageLabel(bytes === null ? null : formatApproxStorage(bytes));
    });
    return () => {
      cancelled = true;
    };
  }, [storageMode]);

  // Release OPFS sync-access handles on teardown so the next session opens cleanly.
  useEffect(() => {
    const handlePageHide = () => {
      void flushAndReleaseDuckDbEngine();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  const toggleFolded = () => useWorkspaceSqlStore.getState().toggleExplorerFolded();

  const remote = useSqlConnectionObjects({
    activeQuery,
    objectView,
    setObjectView,
    tables,
    localTables: schemaTables,
    queries,
    explorerFilter,
    createQuery: handleCreate,
    selectQuery: handleSelect,
    insertAtCursor: (text) => setPredicateSignal((prev) => ({ text, raw: true, nonce: (prev?.nonce ?? 0) + 1 })),
    insertSql: handleEditInEditor,
  });
  const { activeConnection, dbFlag } = remote;

  const explorer = (
    <SqlExplorer
      catalog={explorerCatalog}
      isLoading={activeConnection ? remote.loading : isLoadingTables}
      hasLoaded={catalogLoaded}
      onRefresh={() => (activeConnection ? remote.refreshCatalog() : void handleRefreshTables())}
      onOpenTable={(table) => void tables.open(table)}
      openedTableName={tablePreview?.table.name ?? null}
      onFold={toggleFolded}
      onImportFile={handleStartImport}
      isImportBusy={importBusy}
      onTrySample={() => void handleTrySample()}
      isCreatingSample={isCreatingSample}
      storageMode={storageMode}
      persistRequested={storageRequestedMode === 'opfs'}
      storageUsageLabel={storageUsageLabel}
      filter={explorerFilter}
      onFilterChange={setExplorerFilter}
      {...(remote.renderRemoteTree ? { renderRemoteTree: remote.renderRemoteTree } : {})}
    >
      <SqlQueryList
        queries={queries}
        activeQueryId={activeQueryId}
        onSelect={handleSelect}
        onCreate={() => handleCreate()}
        onRename={tabActions.rename}
        onDelete={tabActions.remove}
        onDuplicate={tabActions.duplicate}
        filter={explorerFilter}
        {...(remote.connectionLabel ? { connectionLabel: remote.connectionLabel } : {})}
      />
      <SqlHistorySection
        entries={history}
        {...(activeConnection ? { connectionId: activeConnection.id } : {})}
        {...(dbFlag ? { connectionLabel: activeConnection?.name ?? t('sqlWorkspace.connection.localName') } : {})}
        open={historyOpen}
        onToggle={() => setHistoryOpen((open) => !open)}
        onOpenEntry={tabActions.openHistoryEntry}
        onClear={() => useWorkspaceSqlStore.getState().clearSqlHistory(activeConnection?.id ?? null)}
      />
    </SqlExplorer>
  );

  const emptyState = (
    <SqlEmptyState
      onCreate={() => handleCreate()}
      onImportFile={(file) => handleStartImport(file, 'picker')}
      onTrySample={() => void handleTrySample()}
      isCreatingSample={isCreatingSample}
    />
  );

  const runSet = runner.runSet?.queryId === activeQuery?.id ? runner.runSet : null;
  const plan = runner.plan?.queryId === activeQuery?.id ? runner.plan : null;
  const lastResult = runSet ? runSet.results.length - 1 : 0;
  const view = runner.view ?? { kind: 'result' as const, index: lastResult };
  const showResultTabs = !tablePreview && !objectView && (runSet !== null || plan !== null);
  const runSetResponse =
    !tablePreview && runSet && view.kind === 'result' && view.index < lastResult
      ? runSet.results[view.index]?.response
      : undefined;
  const isExecuting = activeQuery !== undefined && runner.runningQueryId === activeQuery.id;
  // Load more continues the open stream of the newest run of this query only.
  const moreKey = activeQuery && activeResponse ? moreRowsKey(activeQuery.id, activeResponse.recordedAt) : null;
  const more =
    !tablePreview && !runSetResponse && safeResponseIndex === 0 && runner.more && runner.more.key === moreKey
      ? { rows: runner.more.rows, canRead: !runner.more.done, complete: runner.more.complete, loading: runner.more.loading }
      : undefined;
  const handleLoadMore = () => {
    if (moreKey && activeResponse) {
      void runner.loadMore(moreKey, rowDisplayLimit, activeResponse.rows.length, activeResponse.columns.length);
    }
  };
  const handleInsertPredicate = (predicate: string) =>
    setPredicateSignal((prev) => ({ text: predicate, nonce: (prev?.nonce ?? 0) + 1 }));

  const runBody =
    showResultTabs && view.kind === 'plan' && plan ? (
      <SqlPlanView result={plan} />
    ) : showResultTabs && view.kind === 'messages' && runSet ? (
      <SqlRunMessages runSet={runSet} />
    ) : (
      <SqlResultPreview
        key={tablePreview ? `table:${tablePreview.table.name}` : (activeQuery?.id ?? 'none')}
        response={runSetResponse ?? shownResponse}
        isExecuting={isExecuting}
        rowDisplayLimit={rowDisplayLimit}
        responses={tablePreview || runSetResponse ? undefined : activeResponses}
        selectedResponseIndex={tablePreview ? 0 : safeResponseIndex}
        onSelectResponse={handleSelectResponse}
        querySource={tablePreview || runSetResponse ? undefined : activeQuery?.query}
        profileQuerySource={tablePreview ? tablePreview.sql : editorSourceSql}
        onApplyFix={handleApplyFix}
        onProfileQuery={handleProfileQuery}
        canRun={activeQuery !== undefined && runner.runningQueryId === null}
        onRun={activeQuery ? () => runWhole(activeQuery) : undefined}
        onSaveSnippet={activeQuery && !tablePreview ? () => handleSaveSnippet(activeQuery) : undefined}
        {...(resultSource !== undefined && !runSetResponse ? { source: resultSource } : {})}
        onEditInEditor={handleEditInEditor}
        {...(tablePreview?.back ? { onBack: () => showTablePreview(tablePreview.back!) } : {})}
        handoffs={handoffs}
        {...(more ? { more, onLoadMore: handleLoadMore } : {})}
        {...(tablePreview && tables.foreignKeys ? { foreignKeys: tables.foreignKeys } : {})}
        {...(activeQuery ? { onInsertPredicate: handleInsertPredicate } : {})}
        {...((tablePreview || (!runSetResponse && safeResponseIndex === 0)) ? { onApplySql: handleEditInEditor } : {})}
        {...(tablePreview?.edit ? { rowEdits } : {})}
      />
    );

  const resultBody = remote.renderObjectDetail(runBody);

  const editorPane = activeQuery ? (
    <div ref={editorPaneRef} className="relative flex h-full min-h-0 flex-col">
      <SqlQueryEditor
        query={activeQuery}
        onPatch={handlePatch}
        onRun={(request) => void runner.run(request)}
        onCancel={runner.cancel}
        onSave={tabActions.save}
        isExecuting={isExecuting}
        isBusy={runner.runningQueryId !== null && !isExecuting}
        tables={remote.editorTables}
        {...(activeConnection ? { engine: activeConnection.engine, functions: remote.functions } : {})}
        {...(insertSignal !== null ? { insertSignal } : {})}
        {...(predicateSignal !== null ? { predicateSignal } : {})}
        headerExtra={
          <AskSqlButton
            tables={remote.editorTables}
            {...(activeConnection ? { dialect: sqlDialect(activeConnection.engine).label } : {})}
            // Insert-only: generated SQL lands in the editor for review, never auto-runs.
            onInsert={(sql) => handlePatch(activeQuery.id, { query: sql })}
          />
        }
      />
      {saveDialog !== null && saveDialog.queryId === activeQuery.id ? (
        <SqlSaveQueryPopover
          key={`${activeQuery.id}:${saveDialog.mode}`}
          anchor={editorPaneRef}
          mode={saveDialog.mode}
          initialName={
            saveDialog.mode === 'saveAs'
              ? t('sqlWorkspace.queryList.duplicateName', { name: activeQuery.name })
              : activeQuery.name
          }
          {...(activeQuery.folder !== undefined ? { initialFolder: activeQuery.folder } : {})}
          folders={folders}
          onSave={tabActions.confirmSave}
          onCancel={tabActions.cancelSave}
          {...(activeConnection ? { connectionLabel: `${activeConnection.name} · ${ENGINE_LABEL[activeConnection.engine]}` } : {})}
        />
      ) : null}
    </div>
  ) : (
    emptyState
  );

  // With nothing to edit or show, the empty state gets the whole area instead of a split.
  const split = !activeQuery && !tablePreview && !objectView ? (
    emptyState
  ) : (
    <Group
      orientation="vertical"
      defaultLayout={mainLayout.defaultLayout}
      onLayoutChanged={mainLayout.onLayoutChanged}
      resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
      className="h-full min-h-0"
    >
      <Panel id="sql-editor-pane" defaultSize="40%" minSize={140}>
        {editorPane}
      </Panel>
      <ResizeHandle orientation="horizontal" />
      <Panel id="sql-results-pane" defaultSize="60%" minSize={140}>
        <div className="flex h-full min-h-0 flex-col">
          {runner.stuck ? (
            <SqlStuckQueryBand onRestart={() => void runner.restartEngine()} isRestarting={runner.isRestarting} />
          ) : null}
          {showResultTabs ? (
            <SqlResultTabs runSet={runSet} hasPlan={plan !== null} view={view} onSelect={runner.setView} />
          ) : null}
          <div className="min-h-0 flex-1">{resultBody}</div>
        </div>
      </Panel>
    </Group>
  );

  const main = (
    <div className="flex h-full min-h-0 flex-col">
      {openQueries.length > 0 ? (
        <SqlQueryTabs
          tabs={openQueries}
          activeId={activeQueryId}
          runningId={runner.runningQueryId}
          onSelect={handleSelect}
          onClose={tabActions.close}
          onCreate={() => handleCreate()}
          freeHint={tier === 'free' ? t('sqlWorkspace.tabs.freeHint') : null}
        />
      ) : null}
      <div className="min-h-0 flex-1">{split}</div>
    </div>
  );

  const closePrompt = tabActions.closePromptId
    ? queries.find((q) => q.id === tabActions.closePromptId)
    : undefined;

  return (
    <div
      data-testid="sql-workspace-panel"
      className="flex h-full min-w-0 flex-col bg-bg-base text-fg-base"
    >
      <SqlConnectionBar
        {...(remote.barRemote ? { remote: remote.barRemote } : {})}
        actions={
          <SqlImportButton
            inputRef={importInputRef}
            isBusy={importBusy}
            isPreviewing={sqlImport.isPreviewing}
            onImportFile={(file) => handleStartImport(file, 'picker')}
          />
        }
      />
      {activeConnection?.env === 'prod' ? <SqlProdBanner name={activeConnection.name} readOnly={activeConnection.readOnly} /> : null}
      <div className="flex min-h-0 flex-1">
        {explorerFolded ? (
          <>
            <SqlExplorerRail
              onUnfold={toggleFolded}
              onCreate={() => handleCreate()}
              onImport={handlePickImport}
              onShowHistory={() => {
                setHistoryOpen(true);
                toggleFolded();
              }}
              isImportBusy={importBusy}
            />
            <div className="min-w-0 flex-1">{main}</div>
          </>
        ) : (
          <Group
            orientation="horizontal"
            defaultLayout={sidebarLayout.defaultLayout}
            onLayoutChanged={sidebarLayout.onLayoutChanged}
            resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
            className="min-h-0 flex-1"
          >
            <Panel id="sql-explorer-pane" defaultSize="22%" minSize={200}>
              <div className="h-full border-r border-border-subtle">{explorer}</div>
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel id="sql-main-pane" minSize={360}>
              {main}
            </Panel>
          </Group>
        )}
      </div>
      {sqlImport.modal !== null ? (
        <SqlImportPreviewModal
          format={sqlImport.modal.format}
          preview={sqlImport.modal.preview}
          tableName={sqlImport.modal.tableName}
          existingTableNames={existingTableNames}
          tables={schemaTables}
          target={sqlImport.modal.target}
          mapping={sqlImport.modal.mapping}
          csv={sqlImport.modal.csv}
          isImporting={sqlImport.isImporting}
          isPreviewing={sqlImport.isPreviewing}
          onTableNameChange={sqlImport.setTableName}
          onTargetChange={sqlImport.setTarget}
          onMappingChange={sqlImport.setMapping}
          onCsvChange={(csv) => void sqlImport.setCsv(csv)}
          onConfirm={() => void sqlImport.confirmImport()}
          onCancel={sqlImport.cancelImport}
        />
      ) : null}
      {remote.connectionSheetElement}
      {runner.confirm ? <SqlWriteConfirmDialog confirm={runner.confirm} onResolve={runner.resolveConfirm} /> : null}
      {rowEdits.confirm ? <SqlWriteConfirmDialog confirm={rowEdits.confirm} onResolve={rowEdits.resolveConfirm} /> : null}
      {runner.passwordPrompt ? (
        <SqlPasswordPrompt
          name={runner.passwordPrompt.connectionName}
          refused={runner.passwordPrompt.refused}
          kind={runner.passwordPrompt.kind}
          keepsInKeychain={keepsAskedSecret(runner.passwordPrompt.connectionId, runner.passwordPrompt.kind)}
          onSubmit={(password) => {
            const connectionId = runner.passwordPrompt?.connectionId;
            void runner.submitPassword(password).then(() => {
              if (connectionId) remote.retryCatalogAfterPassword(connectionId);
            });
          }}
          onCancel={runner.dismissPassword}
        />
      ) : null}
      {remote.catalogPasswordPrompt}
      {closePrompt ? (
        <ConfirmDialog
          title={t('sqlWorkspace.tabs.closeTitle', { name: closePrompt.name })}
          body={t('sqlWorkspace.tabs.closeBody')}
          confirmLabel={t('sqlWorkspace.tabs.discard')}
          cancelLabel={t('sqlWorkspace.save.cancel')}
          testId="sql-close-scratch"
          alternative={{
            label: t('sqlWorkspace.tabs.saveFirst'),
            onSelect: () => tabActions.saveBeforeClose(closePrompt.id),
          }}
          onConfirm={() => tabActions.discard(closePrompt.id)}
          onCancel={tabActions.cancelClose}
        />
      ) : null}
    </div>
  );
}

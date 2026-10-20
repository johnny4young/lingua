/**
 * Root of the SQL workspace tab. Local (DuckDB) is the connection in the
 * bar on top; below it the Explorer (or its 44 px rail, Cmd/Ctrl+B) sits
 * beside the editor, with the results under the editor.
 *
 * Wires the workspaceSqlStore, the DuckDB execution path, the capsule
 * builder (capsule auto-attach on success), and the telemetry emit. A single
 * DuckDB engine is shared per session; connections open per call.
 */

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { e2eFixedDurationMs } from '../../testing/e2eDurations';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import { getBundledAppInfo } from '../../../shared/appInfo';
import {
  createBlankSqlQuery,
  queryChangesSchema,
  type SqlQueryV1,
  type SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import { buildSampleTable } from '../../../shared/sqlSampleTable';
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
import { buildSqlResponseCapsule } from '../../runtime/sqlResponseCapsule';
import { useAnnounce } from '../../hooks/useAnnounce';
import {
  trackSqlQueryExecuted,
  trackSqlProfileOpened,
  trackSqlStorageMode,
} from '../../hooks/sqlWorkspaceTelemetry';
import { useSqlImport } from '../../hooks/useSqlImport';
import { useSqlResultHandoffs } from '../../hooks/useSqlResultHandoffs';
import type { SqlImportSource } from '../../hooks/sqlWorkspaceTelemetry';
import { buildSelectStarter } from './sqlResultFormatters';
import { SqlEmptyState } from './SqlEmptyState';
import { SqlQueryList } from './SqlQueryList';
import { SqlQueryEditor } from './SqlQueryEditor';
import { SqlResultPreview, type SqlResultSource } from './SqlResultPreview';
import { AskSqlButton } from './AskSqlButton';
import { SqlExplorer } from './SqlExplorer';
import { SqlExplorerRail, SqlResizeHandle } from './SqlExplorerRail';
import { SqlConnectionBar } from './SqlConnectionBar';
import { SqlImportButton } from './SqlImportButton';
import { EMPTY_SQL_CATALOG, type SqlCatalog, type SqlSchemaTable } from './sqlExplorerModel';
import { SqlImportPreviewModal } from './SqlImportPreviewModal';

/** Compact, locale-agnostic byte label (`~5 MB`); origin-wide, hence approximate. */
function formatApproxStorage(bytes: number): string {
  if (bytes < 1024) return `~${bytes} B`;
  if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `~${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function toResponse(outcome: Awaited<ReturnType<typeof executeQuery>>): SqlResponseV1 {
  return {
    version: 1,
    status: outcome.status,
    rows: outcome.rows,
    columns: outcome.columns,
    rowCount: outcome.rowCount,
    durationMs: e2eFixedDurationMs(outcome.durationMs),
    tooLarge: outcome.tooLarge,
    statementCount: outcome.statementCount,
    recordedAt: new Date().toISOString(),
    ...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
  };
}

export interface SqlWorkspacePanelProps {
  /**
   * The stable workspace tab id. The SQL surface is one collection tab, so
   * the panel binds to the store's `activeQueryId`, not to this id.
   */
  tabId?: string;
}

/** A table opened from the Explorer: its rows on screen, never a saved run. */
interface TablePreview {
  table: SqlSchemaTable;
  sql: string;
  response: SqlResponseV1;
}

const sessionProfileSources = new Map<string, { recordedAt: string; query: string }>();

export function SqlWorkspacePanel(_props: SqlWorkspacePanelProps = {}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
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

  // The editor is never blank while the collection has queries.
  useEffect(() => {
    const store = useWorkspaceSqlStore.getState();
    if (store.activeQueryId !== null) return;
    const first = store.queries[0];
    if (first) store.setActiveQuery(first.id);
  }, [queries.length, activeQueryId]);
  const isExecuting = useWorkspaceSqlStore((state) => state.isExecutingActive);
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
  const [tablePreview, setTablePreview] = useState<TablePreview | null>(null);
  const [isCreatingSample, setIsCreatingSample] = useState(false);
  // Lets the run handler refresh the Explorer without a forward dependency.
  const refreshTablesRef = useRef<() => void>(() => {});
  // Profiles must use the exact SQL behind a response; this session map does not
  // survive reload because persisted responses do not keep their SQL.
  const [, setProfileSourcesVersion] = useState(0);
  const [selectedResponseIndex, setSelectedResponseIndex] = useState(0);
  // The nonce makes the editor append even when the text repeats.
  const [insertSignal, setInsertSignal] = useState<{ text: string; nonce: number } | null>(null);

  const schemaTables = useMemo<SqlSchemaTable[]>(
    () =>
      catalog.tables.map((table) => {
        const format = tableSources[table.name];
        return format ? { ...table, source: format } : table;
      }),
    [catalog.tables, tableSources]
  );
  const explorerCatalog = useMemo(() => ({ ...catalog, tables: schemaTables }), [catalog, schemaTables]);

  const activeQuery: SqlQueryV1 | undefined = useMemo(
    () => queries.find((q) => q.id === activeQueryId),
    [queries, activeQueryId]
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
      ? sessionProfileSources.get(activeQuery.id)
      : undefined;
  const editorSourceSql =
    profileSource !== undefined && profileSource.recordedAt === activeResponse?.recordedAt
      ? profileSource.query
      : undefined;

  const shownResponse = tablePreview?.response ?? activeResponse;
  const resultSource = useMemo<SqlResultSource | undefined>(() => {
    if (tablePreview) {
      return { origin: 'table', sql: tablePreview.sql, tableName: tablePreview.table.name };
    }
    return editorSourceSql !== undefined ? { origin: 'editor', sql: editorSourceSql } : undefined;
  }, [tablePreview, editorSourceSql]);

  const handleCreate = useCallback((sql = '', name = '') => {
    useWorkspaceSqlStore
      .getState()
      .createQuery(createBlankSqlQuery({ id: crypto.randomUUID(), name, query: sql }));
    setSelectedResponseIndex(0);
    setTablePreview(null);
  }, []);

  const handleSelect = useCallback((id: string) => {
    useWorkspaceSqlStore.getState().setActiveQuery(id);
    setSelectedResponseIndex(0);
    setTablePreview(null);
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useWorkspaceSqlStore.getState().updateQuery(id, { name });
  }, []);

  const handleDuplicate = useCallback(
    (id: string) => {
      const source = useWorkspaceSqlStore.getState().getQuery(id);
      const baseName =
        source && source.name.trim().length > 0
          ? source.name.trim()
          : t('sqlWorkspace.queryList.renamePlaceholder');
      useWorkspaceSqlStore.getState().duplicateQuery(id, {
        id: crypto.randomUUID(),
        name: t('sqlWorkspace.queryList.duplicateName', { name: baseName }),
      });
      setSelectedResponseIndex(0);
    },
    [t]
  );

  const handleDelete = useCallback((id: string) => {
    useWorkspaceSqlStore.getState().deleteQuery(id);
    setSelectedResponseIndex(0);
  }, []);

  // Opening a table shows its rows under a generated SQL strip; nothing is saved or added to history.
  const handleOpenTable = useCallback(
    async (table: SqlSchemaTable) => {
      const sql = buildSelectStarter(table.sqlName ?? table.name, table.schemaName);
      const outcome = await executeQuery(sql, { timeoutMs: queryTimeoutMs });
      setTablePreview({ table, sql, response: toResponse(outcome) });
    },
    [queryTimeoutMs]
  );

  const handleEditInEditor = useCallback(
    (sql: string) => {
      setTablePreview(null);
      if (useWorkspaceSqlStore.getState().activeQueryId === null) {
        handleCreate(sql);
        return;
      }
      setInsertSignal((prev) => ({ text: sql, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [handleCreate]
  );

  const handleSelectResponse = useCallback((index: number) => {
    setSelectedResponseIndex(index);
  }, []);

  // Patch the query the editor names, not a closed-over one that may have switched mid-debounce.
  const handlePatch = useCallback((queryId: string, patch: Partial<SqlQueryV1>) => {
    useWorkspaceSqlStore.getState().updateQuery(queryId, patch);
  }, []);

  const handleRun = useCallback(
    async (queryToRun: SqlQueryV1) => {
      if (useWorkspaceSqlStore.getState().isExecutingActive) return;
      useWorkspaceSqlStore.getState().setIsExecutingActive(true);
      setTablePreview(null);
      try {
        const outcome = await executeQuery(queryToRun.query, { timeoutMs: queryTimeoutMs });
        const response = toResponse(outcome);
        const liveIds = new Set(useWorkspaceSqlStore.getState().queries.map((q) => q.id));
        for (const id of sessionProfileSources.keys()) {
          if (!liveIds.has(id)) sessionProfileSources.delete(id);
        }
        sessionProfileSources.set(queryToRun.id, {
          recordedAt: response.recordedAt,
          query: queryToRun.query,
        });
        setProfileSourcesVersion((version) => version + 1);
        useWorkspaceSqlStore.getState().recordResponse(queryToRun.id, response);
        setSelectedResponseIndex(0);
        trackSqlQueryExecuted(response);
        // DDL changed the schema: refresh so the Explorer never lies about what exists.
        if (response.status === 'success' && queryChangesSchema(queryToRun.query)) {
          refreshTablesRef.current();
        }
        announce(
          response.status === 'success'
            ? t('sqlWorkspace.run.announce', { count: response.rowCount })
            : t('sqlWorkspace.run.announceError')
        );

        // Capsule auto-attach: the Mod+Shift+X export picks it up from history.
        let capsule;
        try {
          const appInfo = getBundledAppInfo();
          const platform: 'web' | 'desktop' =
            typeof window !== 'undefined' && window.lingua?.platform === 'desktop'
              ? 'desktop'
              : 'web';
          capsule = await buildSqlResponseCapsule({
            appVersion: appInfo.version,
            query: queryToRun,
            response,
            platform,
          });
        } catch {
          capsule = undefined;
        }
        useExecutionHistoryStore.getState().record({
          language: 'sql',
          status: outcome.status === 'success' ? 'ok' : 'error',
          durationMs: response.durationMs,
          ...(capsule !== undefined ? { lastCapsule: capsule } : {}),
        });
      } catch (err) {
        // `executeQuery` always settles; this catch is defensive.
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.response.errorBand',
          detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
        });
      } finally {
        useWorkspaceSqlStore.getState().setIsExecutingActive(false);
      }
    },
    [queryTimeoutMs, t, announce]
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
      if (updated) void handleRun(updated);
    },
    [handleRun]
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
    }
  }, []);

  useEffect(() => {
    refreshTablesRef.current = () => void handleRefreshTables();
  }, [handleRefreshTables]);

  const existingTableNames = useMemo(() => schemaTables.map((table) => table.name), [schemaTables]);
  const sqlImport = useSqlImport({
    existingTableNames,
    onImported: ({ tableName, format }) => {
      useWorkspaceSqlStore.getState().setTableSource(tableName, format);
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
  const importInputRef = useRef<HTMLDivElement | null>(null);
  const handlePickImport = useCallback(() => {
    importInputRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
  }, []);

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
        /* the Run path surfaces engine failures */
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

  const explorer = (
    <SqlExplorer
      catalog={explorerCatalog}
      isLoading={isLoadingTables}
      onRefresh={() => void handleRefreshTables()}
      onOpenTable={(table) => void handleOpenTable(table)}
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
    >
      <SqlQueryList
        queries={queries}
        activeQueryId={activeQueryId}
        onSelect={handleSelect}
        onCreate={() => handleCreate()}
        onRename={handleRename}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        filter={explorerFilter}
      />
    </SqlExplorer>
  );

  const main = (
    <Group
      orientation="vertical"
      defaultLayout={mainLayout.defaultLayout}
      onLayoutChanged={mainLayout.onLayoutChanged}
      resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
      className="h-full min-h-0"
    >
      <Panel id="sql-editor-pane" defaultSize="40%" minSize={140}>
        {activeQuery ? (
          <SqlQueryEditor
            query={activeQuery}
            onPatch={handlePatch}
            onRun={handleRun}
            isExecuting={isExecuting}
            tables={schemaTables}
            {...(insertSignal !== null ? { insertSignal } : {})}
            headerExtra={
              <AskSqlButton
                tables={schemaTables}
                // Insert-only: generated SQL lands in the editor for review, never auto-runs.
                onInsert={(sql) => handlePatch(activeQuery.id, { query: sql })}
              />
            }
          />
        ) : (
          <SqlEmptyState
            onCreate={() => handleCreate()}
            onImportFile={(file) => handleStartImport(file, 'picker')}
            onTrySample={() => void handleTrySample()}
            isCreatingSample={isCreatingSample}
          />
        )}
      </Panel>
      <SqlResizeHandle orientation="horizontal" />
      <Panel id="sql-results-pane" defaultSize="60%" minSize={140}>
        <SqlResultPreview
          key={tablePreview ? `table:${tablePreview.table.name}` : (activeQuery?.id ?? 'none')}
          response={shownResponse}
          isExecuting={isExecuting}
          rowDisplayLimit={rowDisplayLimit}
          responses={tablePreview ? undefined : activeResponses}
          selectedResponseIndex={tablePreview ? 0 : safeResponseIndex}
          onSelectResponse={handleSelectResponse}
          querySource={tablePreview ? undefined : activeQuery?.query}
          profileQuerySource={tablePreview ? tablePreview.sql : editorSourceSql}
          onApplyFix={handleApplyFix}
          onProfileQuery={handleProfileQuery}
          canRun={activeQuery !== undefined}
          onRun={activeQuery ? () => void handleRun(activeQuery) : undefined}
          onSaveSnippet={
            activeQuery && !tablePreview ? () => handleSaveSnippet(activeQuery) : undefined
          }
          {...(resultSource !== undefined ? { source: resultSource } : {})}
          onEditInEditor={handleEditInEditor}
          handoffs={handoffs}
        />
      </Panel>
    </Group>
  );

  return (
    <div
      data-testid="sql-workspace-panel"
      className="flex h-full min-w-0 flex-col bg-bg-base text-fg-base"
    >
      <SqlConnectionBar
        actions={
          <div ref={importInputRef} className="contents">
            <SqlImportButton
              isBusy={importBusy}
              isPreviewing={sqlImport.isPreviewing}
              onImportFile={(file) => handleStartImport(file, 'picker')}
            />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1">
        {explorerFolded ? (
          <>
            <SqlExplorerRail
              onUnfold={toggleFolded}
              onCreate={() => handleCreate()}
              onImport={handlePickImport}
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
            <SqlResizeHandle orientation="vertical" />
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
          isImporting={sqlImport.isImporting}
          onTableNameChange={sqlImport.setTableName}
          onConfirm={() => void sqlImport.confirmImport()}
          onCancel={sqlImport.cancelImport}
        />
      ) : null}
    </div>
  );
}

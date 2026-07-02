/**
 * RL-097 Slice 2 — Root component of the SQL workspace editor tab.
 * Three-column layout (query list | editor | result).
 *
 * Mirror of `<HttpWorkspacePanel>`. Wires the workspaceSqlStore,
 * the DuckDB execution path, the capsule builder (Fold G — capsule
 * auto-attach on success), and the telemetry emit (Fold F).
 *
 * Connection lifecycle: a single DuckDB engine instance is shared
 * per browser session via the `duckdbClient` module's cached
 * promise. Connections are opened per-call from `executeQuery` and
 * closed on settle.
 */

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { Database, FilePlus2, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import { getBundledAppInfo } from '../../../shared/appInfo';
import {
  SQL_IMPORT_FILE_ACCEPT,
  createBlankSqlQuery,
  type SqlQueryV1,
  type SqlResponseV1,
} from '../../../shared/sqlWorkspace';
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
import { buildSqlResponseCapsule } from '../../runtime/sqlResponseCapsule';
import { useAnnounce } from '../../hooks/useAnnounce';
import {
  trackSqlQueryExecuted,
  trackSqlStorageMode,
} from '../../hooks/sqlWorkspaceTelemetry';
import { useSqlImport } from '../../hooks/useSqlImport';
import type { SqlImportSource } from '../../hooks/sqlWorkspaceTelemetry';
import { buildSelectStarter } from './sqlResultFormatters';
import { EmptyState } from '../ui/EmptyState';
import { SqlQueryList } from './SqlQueryList';
import { SqlQueryEditor } from './SqlQueryEditor';
import { SqlResultPreview } from './SqlResultPreview';
import {
  SqlSchemaBrowser,
  type SqlSchemaColumn,
  type SqlSchemaTable,
} from './SqlSchemaBrowser';
import { SqlImportPreviewModal } from './SqlImportPreviewModal';

/**
 * RL-097 Slice 3 (SQL OPFS) fold C — compact, locale-agnostic byte
 * label (`~5 MB`). Origin-wide storage estimate, hence the leading `~`.
 * Numbers only; the surrounding copy is translated.
 */
function formatApproxStorage(bytes: number): string {
  if (bytes < 1024) return `~${bytes} B`;
  if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `~${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface SqlWorkspacePanelProps {
  /**
   * SQL/HTTP MODEL rework — the SQL surface is a single COLLECTION
   * workspace tab, not one tab per query. `tabId` (the stable workspace
   * tab id) is accepted for the AppLayout / view mount but is NOT a
   * query binding: the editor + result columns bind to the STORE's
   * `activeQueryId`, driven entirely by the in-panel rail. Retained only
   * for call-site compatibility; the panel ignores it for selection.
   */
  tabId?: string;
}

export function SqlWorkspacePanel(_props: SqlWorkspacePanelProps = {}) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  // Persisted layout. Storage key isolated to this surface so it
  // does not clobber the HTTP workspace's layout.
  const layout = useDefaultLayout({
    id: 'lingua-sql-workspace-layout',
    panelIds: ['sql-query-list', 'sql-query-editor', 'sql-result-preview'],
    storage: localStorage,
  });
  const queries = useWorkspaceSqlStore((state) => state.queries);
  const activeQueryId = useWorkspaceSqlStore((state) => state.activeQueryId);

  // SQL/HTTP MODEL rework — the rail is the single source of collection
  // navigation. On mount (and whenever the active id is cleared while
  // queries remain — e.g. after a delete that left an empty active),
  // auto-select the first query so the editor is never blank when the
  // collection is non-empty. Selecting first matches TablePlus reopening
  // onto the top query.
  useEffect(() => {
    const store = useWorkspaceSqlStore.getState();
    if (store.activeQueryId !== null) return;
    const first = store.queries[0];
    if (first) store.setActiveQuery(first.id);
  }, [queries.length, activeQueryId]);
  const isExecuting = useWorkspaceSqlStore((state) => state.isExecutingActive);
  const responsesByQueryId = useWorkspaceSqlStore(
    (state) => state.responsesByQueryId
  );
  const rowDisplayLimit = useSettingsStore(
    (state) => state.sqlWorkspaceRowDisplayLimit
  );
  const queryTimeoutMs = useSettingsStore(
    (state) => state.sqlWorkspaceQueryTimeoutMs
  );
  // RL-097 Slice 3 (SQL OPFS) — the user's persistence preference,
  // applied to the DuckDB engine on mount (before the eager-load).
  const persistTables = useSettingsStore(
    (state) => state.sqlWorkspacePersistTables
  );

  // RL-097 Slice 3 (SQL OPFS) — the RESOLVED storage backing lives in
  // the store so the chip stays live when Settings "Reconnect now"
  // re-resolves the engine. The approximate origin-storage label
  // (fold C) is panel-local and recomputed when the mode flips.
  const storageMode = useWorkspaceSqlStore((state) => state.storageMode);
  const storageRequestedMode = useWorkspaceSqlStore(
    (state) => state.storageRequestedMode
  );
  const [storageUsageLabel, setStorageUsageLabel] = useState<string | null>(
    null
  );

  // Schema/table browser — session-scoped DuckDB table introspection.
  // Populated by a SHOW TABLES probe (+ a cheap per-table column-count
  // pass). Survives query switches because the in-memory DuckDB database
  // is shared per session, not per query.
  const [schemaTables, setSchemaTables] = useState<SqlSchemaTable[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  // Run-history selection — index into the active query's response LRU
  // (0 = newest). A fresh run / query switch resets to 0.
  const [selectedResponseIndex, setSelectedResponseIndex] = useState(0);
  // Schema-browser → editor insert signal. Incrementing the nonce makes
  // the editor append the table starter even when the text is identical
  // to the previous insert.
  const [insertSignal, setInsertSignal] = useState<{
    text: string;
    nonce: number;
  } | null>(null);

  // SQL/HTTP MODEL rework — the editor + result columns bind to the
  // store's `activeQueryId`, the single source of collection navigation
  // driven by the rail. The container tab owns the whole collection, not
  // one query, so there is no per-tab pin.
  const activeQuery: SqlQueryV1 | undefined = useMemo(
    () => queries.find((q) => q.id === activeQueryId),
    [queries, activeQueryId]
  );
  // Per-query response history LRU (newest-first). Drives both the
  // result grid (selected entry) and the run-history list.
  const activeResponses: ReadonlyArray<SqlResponseV1> = activeQuery
    ? (responsesByQueryId[activeQuery.id] ?? [])
    : [];
  // The response currently shown in the grid. Clamp the selected index
  // so a shrinking history (LRU eviction / clear) never points past the
  // end.
  const safeResponseIndex =
    activeResponses.length === 0
      ? 0
      : Math.min(selectedResponseIndex, activeResponses.length - 1);
  const activeResponse: SqlResponseV1 | null =
    activeResponses[safeResponseIndex] ?? null;

  // SQL/HTTP MODEL rework — a new query is a row in the collection, NOT a
  // new editor tab. `createQuery` appends it to the store and selects it
  // (the store sets `activeQueryId` to the new id); the rail re-renders
  // and the editor binds to it.
  const handleCreate = useCallback(() => {
    const q = createBlankSqlQuery({
      id: crypto.randomUUID(),
      name: '',
      query: '',
    });
    useWorkspaceSqlStore.getState().createQuery(q);
    setSelectedResponseIndex(0); // fresh query has no history
  }, []);

  // SQL/HTTP MODEL rework — selecting a rail row moves the store's active
  // query. The rail is the single source of collection navigation; there
  // is no per-query FileTab to focus.
  const handleSelect = useCallback((id: string) => {
    useWorkspaceSqlStore.getState().setActiveQuery(id);
    setSelectedResponseIndex(0); // show the newest run for the switched-to query
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useWorkspaceSqlStore.getState().updateQuery(id, { name });
  }, []);

  // Rail ergonomics — clone the query under a fresh id. The store sets
  // the clone active; the clone starts unrun (no history) so reset the
  // grid selection.
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

  // SQL/HTTP MODEL rework — deleting a rail row removes the query from
  // the collection. `deleteQuery` drops it + its response history and
  // re-points `activeQueryId` to the next surviving query (or null). The
  // workspace tab is unaffected — closing the tab is a separate gesture
  // that leaves the collection intact.
  const handleDelete = useCallback((id: string) => {
    useWorkspaceSqlStore.getState().deleteQuery(id);
    setSelectedResponseIndex(0); // surviving query: show its newest run
  }, []);

  // Schema browser → editor insert. Build a runnable starter for the
  // table and signal the editor to append it. The table name is quoted
  // (ANSI identifier quoting) so names with spaces, reserved words,
  // mixed case, or special characters produce a valid single statement
  // instead of broken — or statement-chaining — SQL.
  const handleInsertTable = useCallback((name: string) => {
    setInsertSignal((prev) => ({
      text: buildSelectStarter(name),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  // Run-history selection — view an older snapshot in the grid.
  const handleSelectResponse = useCallback((index: number) => {
    setSelectedResponseIndex(index);
  }, []);

  // RQ-02 — patch the query the editor names explicitly, never a
  // closed-over `activeQuery` that may have switched during the
  // editor's debounce quiet window. `updateQuery` no-ops on an unknown
  // id, so a flush for a just-deleted query is harmless.
  const handlePatch = useCallback(
    (queryId: string, patch: Partial<SqlQueryV1>) => {
      useWorkspaceSqlStore.getState().updateQuery(queryId, patch);
    },
    []
  );

  const handleRun = useCallback(
    async (queryToRun: SqlQueryV1) => {
      if (useWorkspaceSqlStore.getState().isExecutingActive) return;
      useWorkspaceSqlStore.getState().setIsExecutingActive(true);
      try {
        const outcome = await executeQuery(queryToRun.query, {
          timeoutMs: queryTimeoutMs,
        });
        const response: SqlResponseV1 = {
          version: 1,
          status: outcome.status,
          rows: outcome.rows,
          columns: outcome.columns,
          rowCount: outcome.rowCount,
          durationMs: outcome.durationMs,
          tooLarge: outcome.tooLarge,
          statementCount: outcome.statementCount,
          recordedAt: new Date().toISOString(),
          ...(outcome.errorMessage !== undefined
            ? { errorMessage: outcome.errorMessage }
            : {}),
        };
        useWorkspaceSqlStore.getState().recordResponse(queryToRun.id, response);
        // A fresh run is always the newest entry — show it in the grid.
        setSelectedResponseIndex(0);
        trackSqlQueryExecuted(response);
        // UX Sweep T4 — announce the outcome to screen readers; the result
        // grid only conveys it visually.
        announce(
          response.status === 'success'
            ? t('sqlWorkspace.run.announce', { count: response.rowCount })
            : t('sqlWorkspace.run.announceError')
        );

        // Fold G — capsule auto-attach. Build a RunCapsuleV1 for the
        // execution and stash it on the ExecutionHistoryEntry so the
        // existing Mod+Shift+X export pathway picks it up uniformly.
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

  // Schema/table browser — `SHOW TABLES` introspection plus a SINGLE
  // `information_schema.columns` probe that yields every table's column
  // names + SQL types in one round-trip (replacing the old N-per-table
  // `PRAGMA table_info` loop). The columns drive the count chip, the
  // expandable column list, AND the editor's column-name autocomplete.
  // Uses the same lazy engine singleton; opens a single connection, runs
  // the probes, closes. Failures push a notice but never crash the panel.
  const handleRefreshTables = useCallback(async () => {
    setIsLoadingTables(true);
    let engine: DuckDbEngineHandle;
    try {
      engine = await getDuckDbEngine();
    } catch (err) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.response.engineLoadFailedBand',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
      setIsLoadingTables(false);
      return;
    }
    let connection;
    try {
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
      const { rows } = await connection.query('SHOW TABLES');
      const names: string[] = [];
      for (const row of rows) {
        // DuckDB SHOW TABLES returns a `name` column.
        const value = row['name'];
        if (typeof value === 'string') names.push(value);
      }
      // Single-round-trip column introspection. `information_schema.columns`
      // returns one row per (table, column); grouping in JS by `table_name`
      // (ordered by `ordinal_position`) rebuilds each table's column list
      // without an N-query PRAGMA loop. A failure here leaves every table's
      // columns undefined rather than aborting the whole refresh — the
      // table names still render, just without the count chip / autocomplete.
      const columnsByTable = new Map<string, SqlSchemaColumn[]>();
      try {
        const columnRows = await connection.query(
          'SELECT table_name, column_name, data_type ' +
            'FROM information_schema.columns ' +
            "WHERE table_schema NOT IN ('information_schema', 'pg_catalog') " +
            'ORDER BY table_name, ordinal_position'
        );
        for (const row of columnRows.rows) {
          const tableName = row['table_name'];
          const columnName = row['column_name'];
          const dataType = row['data_type'];
          if (typeof tableName !== 'string' || typeof columnName !== 'string') {
            continue;
          }
          const list = columnsByTable.get(tableName) ?? [];
          list.push({
            name: columnName,
            type: typeof dataType === 'string' ? dataType : 'UNKNOWN',
          });
          columnsByTable.set(tableName, list);
        }
      } catch {
        // Leave the map empty — tables render name-only.
      }
      const tables: SqlSchemaTable[] = names.map((name) => {
        const columns = columnsByTable.get(name);
        return columns !== undefined ? { name, columns } : { name };
      });
      setSchemaTables(tables);
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

  // RL-097 (SQL import) — orchestration hook. Owns the validate → read →
  // preview → confirm → import flow + every notice + the fold-B telemetry.
  // `existingTableNames` feeds the fold-C collision de-duper; a successful
  // import refreshes the schema browser so the new table shows up.
  const existingTableNames = useMemo(
    () => schemaTables.map((table) => table.name),
    [schemaTables]
  );
  const sqlImport = useSqlImport({
    existingTableNames,
    onImported: () => void handleRefreshTables(),
  });
  const importBusy =
    sqlImport.isPreviewing || sqlImport.isImporting || sqlImport.modal !== null;

  // The keyboard-operable primary "Import data" toolbar control: a real
  // <button> that opens the hidden <input type="file"> via `.click()`. The
  // schema-browser "+" button is a second entry point into the same flow.
  const toolbarImportInputRef = useRef<HTMLInputElement | null>(null);
  const handleStartImport = useCallback(
    (file: File, source: SqlImportSource) => {
      void sqlImport.startImport(file, source);
    },
    [sqlImport]
  );

  // MOV.03 — Save-as-snippet nudge. After a first successful run the
  // result surface offers to stash the query in the snippet library so
  // it survives the workspace. `addSnippet` already enforces the
  // Free-tier ceiling (returns null + pushes an upsell); on success we
  // confirm with a status notice. The snippet language is tagged `sql`
  // (Language accepts arbitrary ids) so it round-trips into the library
  // filter cleanly.
  const handleSaveSnippet = useCallback(
    (query: SqlQueryV1) => {
      const label =
        query.name.trim().length > 0
          ? query.name.trim()
          : t('sqlWorkspace.snippet.defaultLabel');
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

  // First-time mount eager-load nudge: kick off the DuckDB engine
  // load in the background so the user's first Run isn't a 7 MiB
  // cold-boot wait. Fire-and-forget; failures surface on the Run
  // path. Only fires once per session.
  //
  // RL-097 Slice 3 (SQL OPFS) — capture the persistence preference
  // BEFORE the engine instantiates so the factory opens the `opfs://`
  // database when requested. After it resolves, reflect the actual
  // backing in the chip, fire the storage-mode telemetry once (fold F),
  // surface a notice if persistence was requested but unavailable
  // (fold D), and compute the approximate storage label (fold C).
  // `persistTables` is read once at mount; flipping the toggle takes
  // effect on the next reload or via Settings "Reconnect now".
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
      })
      .catch(() => {
        /* swallow — user-visible retry happens via Run path */
      });
    return () => {
      cancelled = true;
    };
    // Mount-once: the engine is a session singleton and `persistTables`
    // is intentionally captured at mount (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // RL-097 Slice 3 (SQL OPFS) fold C — recompute the approximate
  // origin-storage label whenever the resolved backing becomes
  // persistent (including after a Settings "Reconnect now"). Origin-wide
  // estimate, hence approximate. No synchronous reset on the non-opfs
  // branch: the chip only renders the label while `storageMode === 'opfs'`,
  // so a stale value is never visible, and the recompute refreshes it the
  // next time the engine resolves to OPFS.
  useEffect(() => {
    if (storageMode !== 'opfs') return;
    let cancelled = false;
    void estimateOriginStorageBytes().then((bytes) => {
      if (!cancelled) {
        setStorageUsageLabel(bytes === null ? null : formatApproxStorage(bytes));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storageMode]);

  // RL-097 Slice 3 (SQL OPFS) fold B — flush + release the engine on
  // page teardown so OPFS sync-access handles release cleanly and the
  // next session/tab re-opens without a stale-lock fallback. Durability
  // does not depend on this (fold A checkpoints every write); this is
  // hygiene. `pagehide` fires on tab close + bfcache navigation.
  useEffect(() => {
    const handlePageHide = () => {
      void flushAndReleaseDuckDbEngine();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  return (
    <div
      data-testid="sql-workspace-panel"
      className="flex h-full min-w-0 flex-col bg-bg-base text-fg-base"
    >
      {/* RL-097 (SQL import) fold F — primary, keyboard-operable
          "Import data" toolbar control. A real <button> opens the hidden
          file input via `.click()`; the native dialog is keyboard
          accessible, so importing never requires a mouse. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => toolbarImportInputRef.current?.click()}
          disabled={importBusy}
          aria-label={t('sqlWorkspace.import.buttonAria')}
          data-testid="sql-workspace-import"
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-panel-alt px-2.5 py-1 text-body-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sqlImport.isPreviewing ? (
            <Loader2 size={13} aria-hidden="true" className="animate-spin" />
          ) : (
            <FilePlus2 size={13} aria-hidden="true" />
          )}
          {sqlImport.isPreviewing
            ? t('sqlWorkspace.import.loadingPreview')
            : t('sqlWorkspace.import.button')}
        </button>
        <input
          ref={toolbarImportInputRef}
          type="file"
          accept={SQL_IMPORT_FILE_ACCEPT}
          disabled={importBusy}
          aria-label={t('sqlWorkspace.import.buttonAria')}
          data-testid="sql-workspace-import-input"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleStartImport(file, 'picker');
            event.target.value = '';
          }}
        />
      </div>
      <Group
        orientation="vertical"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
        className="min-h-0 flex-1"
      >
        <Panel id="sql-query-list" defaultSize="20%" minSize={180}>
          <div className="flex h-full min-h-0 flex-col border-r border-border-subtle bg-bg-panel">
            <div className="min-h-0 flex-1">
              <SqlQueryList
                queries={queries}
                activeQueryId={activeQueryId}
                onSelect={handleSelect}
                onCreate={handleCreate}
                onRename={handleRename}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
              />
            </div>
            <SqlSchemaBrowser
              tables={schemaTables}
              isLoading={isLoadingTables}
              onRefresh={() => void handleRefreshTables()}
              onInsertTable={handleInsertTable}
              canInsert={activeQuery !== undefined}
              storageMode={storageMode}
              persistRequested={storageRequestedMode === 'opfs'}
              storageUsageLabel={storageUsageLabel}
              onImportFile={handleStartImport}
              isImportBusy={importBusy}
            />
          </div>
        </Panel>
        <Panel id="sql-query-editor" defaultSize="45%" minSize={280}>
          {activeQuery ? (
            <SqlQueryEditor
              query={activeQuery}
              onPatch={handlePatch}
              onRun={handleRun}
              isExecuting={isExecuting}
              tables={schemaTables}
              {...(insertSignal !== null ? { insertSignal } : {})}
            />
          ) : (
            <div
              data-testid="sql-workspace-empty"
              className="grid h-full place-items-center px-6 py-10"
            >
              <EmptyState
                icon={<Database size={19} aria-hidden="true" />}
                title={t('sqlWorkspace.empty.title')}
                description={t('sqlWorkspace.empty.body')}
                action={
                  <button
                    type="button"
                    onClick={handleCreate}
                    data-testid="sql-workspace-empty-create"
                    className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                  >
                    <Plus size={13} aria-hidden="true" />
                    {t('sqlWorkspace.empty.cta')}
                  </button>
                }
              />
            </div>
          )}
        </Panel>
        <Panel id="sql-result-preview" defaultSize="35%" minSize={220}>
          <SqlResultPreview
            key={activeQuery?.id ?? 'none'}
            response={activeResponse}
            isExecuting={isExecuting}
            rowDisplayLimit={rowDisplayLimit}
            responses={activeResponses}
            selectedResponseIndex={safeResponseIndex}
            onSelectResponse={handleSelectResponse}
            canRun={activeQuery !== undefined}
            onRun={
              activeQuery ? () => void handleRun(activeQuery) : undefined
            }
            onSaveSnippet={
              activeQuery ? () => handleSaveSnippet(activeQuery) : undefined
            }
          />
        </Panel>
      </Group>
      {/* RL-097 (SQL import) fold D — the preview modal. Renders only
          while an import is in flight; ModalShell owns focus-trap, Esc,
          scrim-close, and focus-restore-to-trigger. */}
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

/**
 * RL-097 Slice 2 — Root component of the SQL workspace bottom-panel
 * tab. Three-column layout (query list | editor | result).
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { getBundledAppInfo } from '../../../shared/appInfo';
import {
  createBlankSqlQuery,
  type SqlQueryV1,
  type SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import {
  executeQuery,
  getDuckDbEngine,
  type DuckDbEngineHandle,
} from '../../runtime/duckdbClient';
import { buildSqlResponseCapsule } from '../../runtime/sqlResponseCapsule';
import { trackSqlQueryExecuted } from '../../hooks/sqlWorkspaceTelemetry';
import { SqlQueryList } from './SqlQueryList';
import { SqlQueryEditor } from './SqlQueryEditor';
import { SqlResultPreview } from './SqlResultPreview';

export function SqlWorkspacePanel() {
  const { t } = useTranslation();
  // Persisted layout. Storage key isolated to this surface so it
  // does not clobber the HTTP workspace's layout.
  const layout = useDefaultLayout({
    id: 'lingua-sql-workspace-layout',
    panelIds: ['sql-query-list', 'sql-query-editor', 'sql-result-preview'],
    storage: localStorage,
  });
  const queries = useWorkspaceSqlStore((state) => state.queries);
  const activeQueryId = useWorkspaceSqlStore((state) => state.activeQueryId);
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

  // Fold C — session-scoped table introspection list. Populated by
  // a SHOW TABLES probe; cleared when the active query changes
  // (different connection might have different tables).
  const [knownTableNames, setKnownTableNames] = useState<string[]>([]);

  const activeQuery: SqlQueryV1 | undefined = useMemo(
    () => queries.find((q) => q.id === activeQueryId),
    [queries, activeQueryId]
  );
  const activeResponse: SqlResponseV1 | null = activeQuery
    ? (responsesByQueryId[activeQuery.id]?.[0] ?? null)
    : null;

  const handleCreate = useCallback(() => {
    const q = createBlankSqlQuery({
      id: crypto.randomUUID(),
      name: '',
      query: '',
    });
    useWorkspaceSqlStore.getState().createQuery(q);
  }, []);

  const handleSelect = useCallback((id: string) => {
    useWorkspaceSqlStore.getState().setActiveQuery(id);
    setKnownTableNames([]); // reset Fold C chips on switch
  }, []);

  const handleRename = useCallback((id: string, name: string) => {
    useWorkspaceSqlStore.getState().updateQuery(id, { name });
  }, []);

  const handleDelete = useCallback((id: string) => {
    useWorkspaceSqlStore.getState().deleteQuery(id);
  }, []);

  const handlePatch = useCallback(
    (patch: Partial<SqlQueryV1>) => {
      if (!activeQuery) return;
      useWorkspaceSqlStore.getState().updateQuery(activeQuery.id, patch);
    },
    [activeQuery]
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
        trackSqlQueryExecuted(response);

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
    [queryTimeoutMs]
  );

  // Fold C — `SHOW TABLES` introspection. Uses the same lazy engine
  // singleton; opens a fresh connection, runs the query, closes.
  // Failures push a notice but never crash the panel.
  const handleShowTables = useCallback(async () => {
    let engine: DuckDbEngineHandle;
    try {
      engine = await getDuckDbEngine();
    } catch (err) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.response.engineLoadFailedBand',
        detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
      });
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
      setKnownTableNames(names);
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
    }
  }, []);

  // First-time mount eager-load nudge: kick off the DuckDB engine
  // load in the background so the user's first Run isn't a 7 MiB
  // cold-boot wait. Fire-and-forget; failures surface on the Run
  // path. Only fires once per session.
  useEffect(() => {
    void getDuckDbEngine().catch(() => {
      /* swallow — user-visible retry happens via Run path */
    });
  }, []);

  return (
    <div
      data-testid="sql-workspace-panel"
      className="flex h-full min-w-0 flex-col"
    >
      <Group
        orientation="vertical"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
        className="h-full"
      >
        <Panel id="sql-query-list" defaultSize="20%" minSize={180}>
          <SqlQueryList
            queries={queries}
            activeQueryId={activeQueryId}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </Panel>
        <Panel id="sql-query-editor" defaultSize="45%" minSize={280}>
          {activeQuery ? (
            <SqlQueryEditor
              query={activeQuery}
              onPatch={handlePatch}
              onRun={handleRun}
              isExecuting={isExecuting}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center">
              <div className="text-sm font-medium">
                {t('sqlWorkspace.empty.title')}
              </div>
              <div className="text-xs text-muted">
                {t('sqlWorkspace.empty.body')}
              </div>
            </div>
          )}
        </Panel>
        <Panel id="sql-result-preview" defaultSize="35%" minSize={220}>
          <SqlResultPreview
            response={activeResponse}
            isExecuting={isExecuting}
            rowDisplayLimit={rowDisplayLimit}
            knownTableNames={knownTableNames}
            onShowTables={handleShowTables}
          />
        </Panel>
      </Group>
    </div>
  );
}

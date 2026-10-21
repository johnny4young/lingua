import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import { getBundledAppInfo } from '../../shared/appInfo';
import { capHistorySql } from '../../shared/sqlHistory';
import { redactSqlSecrets } from '../../shared/sqlStatements';
import { queryChangesSchema, type SqlQueryV1, type SqlResponseV1 } from '../../shared/sqlWorkspace';
import {
  executeQuery,
  duckDbErrorDetail,
  executeSqlScript,
  restartDuckDbEngine,
  type DuckDbExecuteOutcome,
  type SqlResultCursor,
} from '../runtime/duckdbClient';
import {
  buildExplainSql,
  buildSingleSelectCheckSql,
  isSingleSelect,
  parseExplainRows,
  type SqlPlan,
} from '../runtime/sqlExplainPlan';
import { buildSqlResponseCapsule } from '../runtime/sqlResponseCapsule';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { useUIStore } from '../stores/uiStore';
import { useWorkspaceSqlStore } from '../stores/workspaceSqlStore';
import { e2eFixedDurationMs } from '../testing/e2eDurations';
import type { SqlRunRequest } from '../components/SqlWorkspace/SqlQueryEditor';
import { useAnnounce } from './useAnnounce';
import { trackSqlQueryExecuted } from './sqlWorkspaceTelemetry';

export function toSqlResponse(outcome: DuckDbExecuteOutcome): SqlResponseV1 {
  return {
    version: 1,
    status: outcome.status,
    rows: outcome.rows,
    columns: outcome.columns,
    rowCount: outcome.rowCount,
    durationMs: e2eFixedDurationMs(outcome.durationMs),
    tooLarge: outcome.tooLarge,
    ...(outcome.rowCountIsLowerBound ? { rowCountIsLowerBound: true } : {}),
    statementCount: outcome.statementCount,
    recordedAt: new Date().toISOString(),
    ...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
  };
}

/** A run of several statements: one result per statement that ran, for this session only. */
export interface SqlRunSet {
  queryId: string;
  results: Array<{ sql: string; response: SqlResponseV1 }>;
  /** Statements after the one that failed, which did not run. */
  notRun: string[];
}

export interface SqlPlanResult {
  queryId: string;
  sql: string;
  analyzed: boolean;
  plan: SqlPlan | null;
  errorMessage?: string;
}

export type SqlResultView = { kind: 'result'; index: number } | { kind: 'messages' } | { kind: 'plan' };

/** The SQL behind each query's newest response, so Profile and the strip use exactly what ran. */
export const sessionRunSources = new Map<string, { recordedAt: string; query: string }>();

/** Rows read past the window with Load more, for one response; session only. */
interface SqlMoreRows {
  /** `${queryId}:${recordedAt}` of the response they continue. */
  key: string;
  rows: Array<Record<string, unknown>>;
  /** Nothing more to read: the stream ended, hit the session cap or failed. */
  done: boolean;
  /** The stream ended, so the rows read are the whole result. */
  complete: boolean;
  /** JSON size of `rows`, counted against the session byte cap. */
  bytes: number;
  loading: boolean;
}

/** Window plus Load more never holds more than this many rows in memory. */
export const SQL_SESSION_ROW_CAP = 100_000;
/** A wide result holds fewer rows: about a gigabyte of heap per ten million cells. */
const SQL_SESSION_CELL_CAP = 4_000_000;
/** Large text or BLOB cells hit this before the cell cap does. */
const SQL_SESSION_BYTE_CAP = 256 * 1024 * 1024;

export const sessionRowCap = (columnCount: number) =>
  Math.min(SQL_SESSION_ROW_CAP, Math.floor(SQL_SESSION_CELL_CAP / Math.max(1, columnCount)));

export const moreRowsKey = (queryId: string, recordedAt: string) => `${queryId}:${recordedAt}`;

interface SqlRunState {
  runningQueryId: string | null;
  more: SqlMoreRows | null;
  runSet: SqlRunSet | null;
  plan: SqlPlanResult | null;
  view: SqlResultView | null;
  stuck: boolean;
  isRestarting: boolean;
}

/** Module-level so a run outlives the panel, which unmounts whenever another editor tab is active. */
const useSqlRunState = create<SqlRunState>(() => ({
  runningQueryId: null,
  more: null,
  runSet: null,
  plan: null,
  view: null,
  stuck: false,
  isRestarting: false,
}));
let activeController: AbortController | null = null;
// One open result stream at a time: the newest run's, until Load more drains it or something replaces it.
let activeCursor: { key: string; cursor: SqlResultCursor } | null = null;

function dropCursor(): void {
  const open = activeCursor;
  activeCursor = null;
  void open?.cursor.close();
}
const setRunState = (patch: Partial<SqlRunState>) => useSqlRunState.setState(patch);

const isResult = (status: SqlResponseV1['status']) => status === 'success' || status === 'too-large';

function recordRun(queryId: string, sql: string, response: SqlResponseV1): void {
  const capped = capHistorySql(redactSqlSecrets(sql));
  useWorkspaceSqlStore.getState().recordHistory({
    version: 1,
    id: crypto.randomUUID(),
    queryId,
    sql: capped.sql,
    ...(capped.truncated ? { truncated: true } : {}),
    status: response.status,
    durationMs: response.durationMs,
    rowCount: response.rowCount,
    recordedAt: response.recordedAt,
  });
  trackSqlQueryExecuted(response);
}

interface UseSqlRunnerOptions {
  timeoutMs: number;
  onBeforeRun: () => void;
  onSchemaChanged: () => void;
}

/**
 * Runs what the editor asks for: statements one by one on one connection,
 * or Explain. Holds the cooperative Cancel and, when DuckDB ignores it,
 * the offer to restart the engine.
 */
export function useSqlRunner({ timeoutMs, onBeforeRun, onSchemaChanged }: UseSqlRunnerOptions) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { runningQueryId, more, runSet, plan, view, stuck, isRestarting } = useSqlRunState();

  const runExplain = useCallback(
    async (query: SqlQueryV1, statement: string, signal: AbortSignal) => {
      const check = await executeQuery(buildSingleSelectCheckSql(statement), { timeoutMs, signal });
      const { sql, analyzed } = buildExplainSql(
        statement,
        isResult(check.status) && isSingleSelect(check.rows)
      );
      const outcome = await executeQuery(sql, { timeoutMs, signal });
      if (outcome.stillRunning) setRunState({ stuck: true });
      const parsed = isResult(outcome.status) ? parseExplainRows(outcome.rows, analyzed) : null;
      setRunState({
        plan: {
          queryId: query.id,
          sql: statement,
          analyzed,
          plan: parsed,
          ...(parsed === null
            ? { errorMessage: outcome.errorMessage ?? t('sqlWorkspace.plan.unreadable') }
            : {}),
        },
        view: { kind: 'plan' },
      });
    },
    [timeoutMs, t]
  );

  const runStatements = useCallback(
    async (query: SqlQueryV1, statements: string[], signal: AbortSignal) => {
      const results: SqlRunSet['results'] = [];
      const outcomes = await executeSqlScript(statements, {
        timeoutMs,
        signal,
        keepCursor: true,
        onStatement: (index, outcome) => {
          const response = toSqlResponse(outcome);
          results.push({ sql: statements[index] ?? '', response });
          recordRun(query.id, statements[index] ?? '', response);
        },
      });
      // An engine that fails to load reports once, before any statement.
      if (results.length === 0 && outcomes[0]) {
        const response = toSqlResponse(outcomes[0]);
        results.push({ sql: statements[0] ?? '', response });
        recordRun(query.id, statements[0] ?? '', response);
      }
      const last = results[results.length - 1];
      if (!last) return;
      if (outcomes.some((outcome) => outcome.stillRunning)) setRunState({ stuck: true });
      const liveIds = new Set(useWorkspaceSqlStore.getState().queries.map((q) => q.id));
      for (const id of sessionRunSources.keys()) if (!liveIds.has(id)) sessionRunSources.delete(id);
      sessionRunSources.set(query.id, { recordedAt: last.response.recordedAt, query: last.sql });
      useWorkspaceSqlStore.getState().recordResponse(query.id, last.response);
      const cursor = outcomes[outcomes.length - 1]?.cursor;
      const key = moreRowsKey(query.id, last.response.recordedAt);
      if (cursor) activeCursor = { key, cursor };
      setRunState({ more: cursor ? { key, rows: [], done: false, complete: false, bytes: 0, loading: false } : null });
      setRunState(
        statements.length > 1
          ? {
              runSet: { queryId: query.id, results, notRun: statements.slice(results.length) },
              view: { kind: 'result', index: results.length - 1 },
            }
          : { runSet: null, view: null }
      );
      if (results.some(({ sql, response }) => response.status === 'success' && queryChangesSchema(sql))) {
        onSchemaChanged();
      }
      announce(
        isResult(last.response.status)
          ? t('sqlWorkspace.run.announce', { count: last.response.rowCount })
          : last.response.status === 'cancelled'
            ? t('sqlWorkspace.run.announceCancelled')
            : t('sqlWorkspace.run.announceError')
      );
      // Capsule auto-attach: the Mod+Shift+X export picks it up from history.
      let capsule;
      try {
        capsule = await buildSqlResponseCapsule({
          appVersion: getBundledAppInfo().version,
          query: { ...query, query: last.sql },
          response: last.response,
          platform: window.lingua?.platform === 'desktop' ? 'desktop' : 'web',
        });
      } catch {
        capsule = undefined;
      }
      useExecutionHistoryStore.getState().record({
        language: 'sql',
        status: last.response.status === 'success' ? 'ok' : 'error',
        durationMs: last.response.durationMs,
        ...(capsule !== undefined ? { lastCapsule: capsule } : {}),
      });
    },
    [timeoutMs, t, announce, onSchemaChanged]
  );

  const run = useCallback(
    async ({ query, mode, statements }: SqlRunRequest) => {
      if (activeController !== null || statements.length === 0) return;
      const controller = new AbortController();
      activeController = controller;
      dropCursor();
      setRunState({ runningQueryId: query.id });
      onBeforeRun();
      try {
        if (mode === 'explain') await runExplain(query, statements[0]!, controller.signal);
        else await runStatements(query, statements, controller.signal);
      } catch (err) {
        // The engine calls settle; this is defensive.
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.response.errorBand',
          detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
        });
      } finally {
        activeController = null;
        setRunState({ runningQueryId: null });
      }
    },
    [onBeforeRun, runExplain, runStatements]
  );

  const cancel = useCallback(() => activeController?.abort(), []);

  const restartEngine = useCallback(async () => {
    setRunState({ isRestarting: true });
    try {
      dropCursor();
      setRunState({ more: null });
      await restartDuckDbEngine();
      setRunState({ stuck: false });
      onSchemaChanged();
    } finally {
      setRunState({ isRestarting: false });
    }
  }, [onSchemaChanged]);
  const setView = useCallback((next: SqlResultView | null) => setRunState({ view: next }), []);

  // Reads the next rows of the open stream; the window already read counts toward the session cap.
  const loadMore = useCallback(async (key: string, limit: number, windowRows: number, columnCount: number) => {
    const state = useSqlRunState.getState();
    if (!activeCursor || activeCursor.key !== key || state.more?.key !== key || state.more.loading) return;
    const room = sessionRowCap(columnCount) - windowRows - state.more.rows.length;
    setRunState({ more: { ...state.more, loading: true } });
    const { cursor } = activeCursor;
    let batch: { rows: Array<Record<string, unknown>>; done: boolean; bytes: number };
    let failed = false;
    try {
      batch = await cursor.next(Math.max(0, Math.min(limit, room)), SQL_SESSION_BYTE_CAP - state.more.bytes);
    } catch (err) {
      failed = true;
      batch = { rows: [], done: true, bytes: 0 };
      const detail = duckDbErrorDetail(err);
      useUIStore.getState().pushStatusNotice({
        tone: 'error',
        messageKey: 'sqlWorkspace.grid.loadMoreFailed',
        ...(detail ? { detail } : {}),
      });
    }
    const complete = batch.done && !failed;
    // No rows without the end of the stream means the byte cap is full.
    const stopped = batch.done || room - batch.rows.length <= 0 || batch.rows.length === 0;
    if (stopped && activeCursor?.key === key) dropCursor();
    const current = useSqlRunState.getState().more;
    if (current?.key !== key) return;
    setRunState({
      more: { key, rows: [...current.rows, ...batch.rows], done: stopped, complete, bytes: current.bytes + batch.bytes, loading: false },
    });
  }, []);

  // Mod+. cancels from anywhere in the SQL tab, not only from the editor.
  useEffect(() => {
    if (runningQueryId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '.') {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runningQueryId, cancel]);

  return {
    run,
    cancel,
    runningQueryId,
    runSet,
    plan,
    view,
    setView,
    more,
    loadMore,
    stuck,
    isRestarting,
    restartEngine,
  };
}

/** Clears the module-level run state between tests. */
export function resetSqlRunStateForTests(): void {
  activeController = null;
  activeCursor = null;
  useSqlRunState.setState(useSqlRunState.getInitialState());
}

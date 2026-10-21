import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBundledAppInfo } from '../../shared/appInfo';
import { capHistorySql } from '../../shared/sqlHistory';
import { queryChangesSchema, type SqlQueryV1, type SqlResponseV1 } from '../../shared/sqlWorkspace';
import {
  executeQuery,
  executeSqlScript,
  restartDuckDbEngine,
  type DuckDbExecuteOutcome,
} from '../runtime/duckdbClient';
import { buildExplainSql, parseExplainRows, type SqlPlan } from '../runtime/sqlExplainPlan';
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

const isResult = (status: SqlResponseV1['status']) => status === 'success' || status === 'too-large';

function recordRun(queryId: string, sql: string, response: SqlResponseV1): void {
  const capped = capHistorySql(sql);
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
  const [runningQueryId, setRunningQueryId] = useState<string | null>(null);
  const [runSet, setRunSet] = useState<SqlRunSet | null>(null);
  const [plan, setPlan] = useState<SqlPlanResult | null>(null);
  const [view, setView] = useState<SqlResultView | null>(null);
  const [stuck, setStuck] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const runExplain = useCallback(
    async (query: SqlQueryV1, statement: string, signal: AbortSignal) => {
      const { sql, analyzed } = buildExplainSql(statement);
      const outcome = await executeQuery(sql, { timeoutMs, signal });
      if (outcome.stillRunning) setStuck(true);
      const parsed = isResult(outcome.status) ? parseExplainRows(outcome.rows, analyzed) : null;
      setPlan({
        queryId: query.id,
        sql: statement,
        analyzed,
        plan: parsed,
        ...(parsed === null
          ? { errorMessage: outcome.errorMessage ?? t('sqlWorkspace.plan.unreadable') }
          : {}),
      });
      setView({ kind: 'plan' });
    },
    [timeoutMs, t]
  );

  const runStatements = useCallback(
    async (query: SqlQueryV1, statements: string[], signal: AbortSignal) => {
      const results: SqlRunSet['results'] = [];
      const outcomes = await executeSqlScript(statements, {
        timeoutMs,
        signal,
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
      if (outcomes.some((outcome) => outcome.stillRunning)) setStuck(true);
      sessionRunSources.set(query.id, { recordedAt: last.response.recordedAt, query: last.sql });
      useWorkspaceSqlStore.getState().recordResponse(query.id, last.response);
      if (statements.length > 1) {
        setRunSet({ queryId: query.id, results, notRun: statements.slice(results.length) });
        setView({ kind: 'result', index: results.length - 1 });
      } else {
        setRunSet(null);
        setView(null);
      }
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
      if (controllerRef.current !== null || statements.length === 0) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunningQueryId(query.id);
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
        controllerRef.current = null;
        setRunningQueryId(null);
      }
    },
    [onBeforeRun, runExplain, runStatements]
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const restartEngine = useCallback(async () => {
    setIsRestarting(true);
    try {
      await restartDuckDbEngine();
      setStuck(false);
      onSchemaChanged();
    } finally {
      setIsRestarting(false);
    }
  }, [onSchemaChanged]);

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
    stuck,
    isRestarting,
    restartEngine,
  };
}

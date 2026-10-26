/**
 * The engine for database connections: statements go through the bridge
 * (main's SQL host on desktop, the browser's HTTP engines on the web) one at a time and come back in the
 * Local engine's shape, with the rest of a windowed result behind a cursor.
 */

import type { SqlRemoteEngine } from '../../shared/sqlConnections';
import type { SqlDbBridge, SqlDbFixHint, SqlDbRunResult } from '../../shared/sqlDb';
import type { DuckDbExecuteOutcome, SqlResultCursor } from './duckdbClient';
import { appPlatform } from '../utils/appPlatform';
import { createWebSqlDb } from './sqlWebDb';

export type RemoteOutcome = DuckDbExecuteOutcome & { engine: SqlRemoteEngine; fix?: SqlDbFixHint; affectedRows?: number };

let webBridge: SqlDbBridge | null = null;

/** Main's bridge on desktop; on the web, the browser's own for session-only Turso and Neon connections. */
export const sqlDbBridge = (): SqlDbBridge | null =>
  appPlatform() === 'desktop' ? (window.lingua?.db ?? null) : (webBridge ??= createWebSqlDb());

const PAGE_BYTES = 64 * 1024 * 1024;

function cursorFor(db: SqlDbBridge, runId: string): SqlResultCursor {
  let closed = false;
  return {
    async next(limit, maxBytes = PAGE_BYTES) {
      if (closed) return { rows: [], done: true, bytes: 0 };
      const page = await db.fetch(runId, Math.max(1, Math.min(limit, 10_000)), Math.max(1, Math.min(maxBytes, PAGE_BYTES)));
      // A failed read throws, so a partial result never passes for a whole one.
      if (page.errorMessage) {
        closed = true;
        throw new Error(page.errorMessage);
      }
      if (page.done) closed = true;
      return { rows: page.rows, done: page.done, bytes: page.bytes };
    },
    async close() {
      if (closed) return;
      closed = true;
      await db.closeRun(runId).catch(() => undefined);
    },
  };
}

function toOutcome(result: SqlDbRunResult): RemoteOutcome {
  // A write answers the way Local does: one Count row with the rows it touched.
  const counted = result.status === 'success' && result.columns.length === 0 && result.affectedRows !== undefined;
  return {
    status: result.status,
    engine: result.engine,
    rows: counted ? [{ Count: String(result.affectedRows) }] : result.rows,
    columns: counted ? [{ name: 'Count', type: 'BIGINT' }] : result.columns,
    rowCount: counted ? 1 : result.rowCount,
    durationMs: result.durationMs,
    tooLarge: result.tooLarge,
    ...(result.rowCountIsLowerBound ? { rowCountIsLowerBound: true } : {}),
    statementCount: 1,
    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
    ...(result.fix ? { fix: result.fix } : {}),
    ...(result.affectedRows !== undefined ? { affectedRows: result.affectedRows } : {}),
  };
}

const isResultStatus = (status: RemoteOutcome['status']) => status === 'success' || status === 'too-large';

/**
 * Runs statements in order on one connection; the session carries settings
 * and transactions from one to the next. Stops at the first that fails.
 */
export async function executeRemoteScript(
  db: SqlDbBridge,
  connectionId: string,
  statements: ReadonlyArray<string>,
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    keepCursor?: boolean;
    /** The typed connection name, which lets writes through on production and lifts read-only. */
    confirmName?: string;
    onStatement?: (index: number, outcome: RemoteOutcome) => void;
  }
): Promise<RemoteOutcome[]> {
  const outcomes: RemoteOutcome[] = [];
  for (const [index, sql] of statements.entries()) {
    if (options.signal?.aborted) break;
    const runId = crypto.randomUUID();
    const onAbort = () => void db.cancel(runId);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    let result: SqlDbRunResult;
    try {
      result = await db.execute(runId, connectionId, sql, {
        timeoutMs: options.timeoutMs,
        ...(options.confirmName !== undefined ? { readWrite: { confirmName: options.confirmName } } : {}),
      });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
    const outcome = toOutcome(options.signal?.aborted && !isResultStatus(result.status) ? { ...result, status: 'cancelled' } : result);
    const last = index === statements.length - 1;
    if (result.hasMore) {
      if (options.keepCursor && last) outcome.cursor = cursorFor(db, runId);
      else void db.closeRun(runId).catch(() => undefined);
    }
    outcomes.push(outcome);
    options.onStatement?.(index, outcome);
    if (!isResultStatus(outcome.status)) break;
  }
  return outcomes;
}

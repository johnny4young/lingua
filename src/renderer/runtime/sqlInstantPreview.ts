import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import { INSTANT_SAMPLE_ROWS, instantAstBlockReason, type InstantBlockReason } from '../../shared/sqlCtePreview';
import { executeQuery } from './duckdbClient';
import { buildSingleSelectCheckSql } from './sqlExplainPlan';

export const INSTANT_TIMEOUT_MS = 3_000;

export type InstantPreviewResult =
  | {
      kind: 'rows';
      columns: SqlColumnMetadata[];
      rows: Array<Record<string, unknown>>;
      /** The sample filled up, so the full result has at least this many rows. */
      capped: boolean;
      durationMs: number;
    }
  | { kind: 'error'; message: string }
  /** `stuck` when DuckDB had not stopped the sample when the budget ran out. */
  | { kind: 'timeout'; stuck?: boolean }
  /** DuckDB's parser says the sampled SQL is not exactly one SELECT. */
  | { kind: 'rejected' }
  | { kind: 'blocked'; reason: InstantBlockReason };

const NOT_A_SELECT = /only select statements/i;

/** Parser verdict from `json_serialize_sql`: the parsed statement, a syntax error message, or false for anything but one SELECT. */
function singleSelectVerdict(rows: ReadonlyArray<Record<string, unknown>>): { statements: unknown[] } | false | string {
  try {
    const parsed = JSON.parse(String(rows[0]?.['j'])) as { error?: unknown; error_message?: unknown; statements?: unknown };
    if (parsed.error === false) return Array.isArray(parsed.statements) && parsed.statements.length === 1 ? { statements: parsed.statements } : false;
    const message = typeof parsed.error_message === 'string' ? parsed.error_message : '';
    return message && !NOT_A_SELECT.test(message) ? message : false;
  } catch {
    return false;
  }
}

/** Checks with DuckDB's own parser that `sql` is one SELECT, then runs it; null once `signal` aborts. */
export async function runInstantPreview(sql: string, signal: AbortSignal): Promise<InstantPreviewResult | null> {
  // The check and the sample share one budget.
  const deadline = performance.now() + INSTANT_TIMEOUT_MS;
  const options = () => ({ timeoutMs: Math.max(1, Math.round(deadline - performance.now())), signal });
  const check = await executeQuery(buildSingleSelectCheckSql(sql), options());
  if (signal.aborted || check.status === 'cancelled') return null;
  if (check.status === 'timeout') return { kind: 'timeout' };
  if (check.status !== 'success') return { kind: 'error', message: check.errorMessage ?? check.status };
  const verdict = singleSelectVerdict(check.rows);
  if (verdict === false) return { kind: 'rejected' };
  if (typeof verdict === 'string') return { kind: 'error', message: verdict };
  const reason = instantAstBlockReason(verdict.statements);
  if (reason) return { kind: 'blocked', reason };
  const outcome = await executeQuery(sql, options());
  if (signal.aborted || outcome.status === 'cancelled') return null;
  if (outcome.status === 'timeout') return { kind: 'timeout', ...(outcome.stillRunning ? { stuck: true } : {}) };
  if (outcome.status !== 'success' && outcome.status !== 'too-large') {
    return { kind: 'error', message: outcome.errorMessage ?? outcome.status };
  }
  return {
    kind: 'rows',
    columns: outcome.columns,
    rows: outcome.rows,
    capped: outcome.rows.length >= INSTANT_SAMPLE_ROWS,
    durationMs: outcome.durationMs,
  };
}

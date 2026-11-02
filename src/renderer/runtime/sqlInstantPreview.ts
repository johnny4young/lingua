import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import { INSTANT_SAMPLE_ROWS } from '../../shared/sqlCtePreview';
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
  | { kind: 'timeout' }
  /** DuckDB's parser says the sampled SQL is not exactly one SELECT. */
  | { kind: 'rejected' };

const NOT_A_SELECT = /only select statements/i;

/** Parser verdict from `json_serialize_sql`: true, a syntax error message, or false for anything but one SELECT. */
function singleSelectVerdict(rows: ReadonlyArray<Record<string, unknown>>): true | false | string {
  try {
    const parsed = JSON.parse(String(rows[0]?.['j'])) as { error?: unknown; error_message?: unknown; statements?: unknown };
    if (parsed.error === false) return Array.isArray(parsed.statements) && parsed.statements.length === 1;
    const message = typeof parsed.error_message === 'string' ? parsed.error_message : '';
    return message && !NOT_A_SELECT.test(message) ? message : false;
  } catch {
    return false;
  }
}

/** Checks with DuckDB's own parser that `sql` is one SELECT, then runs it; null once `signal` aborts. */
export async function runInstantPreview(sql: string, signal: AbortSignal): Promise<InstantPreviewResult | null> {
  const options = { timeoutMs: INSTANT_TIMEOUT_MS, signal };
  const check = await executeQuery(buildSingleSelectCheckSql(sql), options);
  if (signal.aborted) return null;
  if (check.status !== 'success') return { kind: 'error', message: check.errorMessage ?? check.status };
  const verdict = singleSelectVerdict(check.rows);
  if (verdict === false) return { kind: 'rejected' };
  if (verdict !== true) return { kind: 'error', message: verdict };
  const outcome = await executeQuery(sql, options);
  if (signal.aborted || outcome.status === 'cancelled') return null;
  if (outcome.status === 'timeout') return { kind: 'timeout' };
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

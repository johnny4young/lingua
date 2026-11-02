import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import { INSTANT_SAMPLE_ROWS, instantAstBlockReason, type InstantBlockReason } from '../../shared/sqlCtePreview';
import { parseSerializedSql, serializedSqlCanRebuild } from '../../shared/sqlExprBreakdown';
import { executeQuery } from './duckdbClient';

export const INSTANT_TIMEOUT_MS = 3_000;

export type InstantPreviewResult =
  | {
      kind: 'rows';
      columns: SqlColumnMetadata[];
      rows: Array<Record<string, unknown>>;
      /** The sample filled up, so the full result has at least this many rows. */
      capped: boolean;
      durationMs: number;
      /** DuckDB's parse of the sampled SQL, for the expression breakdown; empty when it cannot be rebuilt. */
      statements: unknown[];
    }
  | { kind: 'error'; message: string }
  /** `stuck` when DuckDB had not stopped the query when the budget ran out. */
  | { kind: 'timeout'; stuck?: boolean }
  /** DuckDB's parser says the sampled SQL is not exactly one SELECT. */
  | { kind: 'rejected' }
  | { kind: 'blocked'; reason: InstantBlockReason };

const NOT_A_SELECT = /only select statements/i;

/** One round trip: DuckDB's parse of `sql` and the functions the user defined, which the parse cannot see into. */
function buildCheckSql(sql: string): string {
  const parse = `json_serialize_sql('${sql.replaceAll("'", "''")}')`;
  return `SELECT ${parse} AS j, (SELECT to_json(list(lower(function_name))) FROM duckdb_functions() WHERE NOT internal) AS user_functions`;
}

function userFunctionNames(rows: ReadonlyArray<Record<string, unknown>>): Set<string> {
  const raw = rows[0]?.['user_functions'];
  if (typeof raw !== 'string') return new Set();
  const names: unknown = JSON.parse(raw);
  return new Set(Array.isArray(names) ? names.map(String) : []);
}

/** Parser verdict from `json_serialize_sql`: the parsed statement, a syntax error message, or false for anything but one SELECT. */
function singleSelectVerdict(rows: ReadonlyArray<Record<string, unknown>>): { statements: unknown[]; rebuildable: boolean; userFunctions: Set<string> } | false | string {
  try {
    const raw = String(rows[0]?.['j']);
    const parsed = parseSerializedSql(raw) as { error?: unknown; error_message?: unknown; statements?: unknown };
    if (parsed.error === false) {
      if (!Array.isArray(parsed.statements) || parsed.statements.length !== 1) return false;
      return { statements: parsed.statements, rebuildable: serializedSqlCanRebuild(raw), userFunctions: userFunctionNames(rows) };
    }
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
  const check = await executeQuery(buildCheckSql(sql), options());
  if (signal.aborted || check.status === 'cancelled') return null;
  if (check.status === 'timeout') return { kind: 'timeout', ...(check.stillRunning ? { stuck: true } : {}) };
  if (check.status !== 'success') return { kind: 'error', message: check.errorMessage ?? check.status };
  const verdict = singleSelectVerdict(check.rows);
  if (verdict === false) return { kind: 'rejected' };
  if (typeof verdict === 'string') return { kind: 'error', message: verdict };
  let reason: InstantBlockReason | undefined;
  try {
    reason = instantAstBlockReason(verdict.statements, verdict.userFunctions);
  } catch {
    // Too deep to walk means it was not checked, so it does not run.
    return { kind: 'rejected' };
  }
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
    statements: verdict.rebuildable ? verdict.statements : [],
  };
}

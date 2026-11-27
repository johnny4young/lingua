/**
 * on-demand DuckDB column summaries.
 *
 * A profile intentionally re-runs only a single read query after an explicit
 * user action. It never writes a workspace response, run-history entry, or
 * ledger row: the returned data is derived UI state, not another user run.
 */

import {
  type ExecuteQueryOptions,
  countSqlStatements,
  executeQuery,
} from './duckdbClient';
import { MAX_QUERY_BYTES, utf8ByteLength, type SqlQueryStatus } from '../../shared/sqlWorkspace';
import { sqlCodeOnly, trimSqlComments } from '../../shared/sqlStatements';

export interface SqlColumnProfile {
  columnName: string;
  columnType: string;
  min: string | null;
  max: string | null;
  approximateUnique: string | null;
  average: string | null;
  standardDeviation: string | null;
  nullPercentage: string | null;
}

export type SqlColumnProfileOutcome =
  | {
      status: 'success' | 'too-large';
      profiles: SqlColumnProfile[];
      tooLarge: boolean;
    }
  | {
      status: 'not-profileable' | Exclude<SqlQueryStatus, 'success' | 'too-large'>;
      errorMessage?: string;
    };

const PROFILEABLE_QUERY_START = /^(?:select|with)\b/i;
// `replace` is deliberately absent: DuckDB's mutating spellings of REPLACE
// (CREATE OR REPLACE, INSERT OR REPLACE INTO) always co-occur with a keyword
// already in this list, while the scalar replace() function and
// SELECT * REPLACE (…) are common in read-only queries and must stay
// profileable.
const MUTATING_SQL_KEYWORDS =
  /\b(?:alter|analyze|attach|begin|call|checkpoint|commit|copy|create|delete|detach|drop|export|grant|import|insert|install|load|merge|pragma|revoke|rollback|set|truncate|update|use|vacuum)\b/i;

/**
 * The source as one read query that is safe to run again, without the
 * comments and terminator around it, or null. Keep this guard deliberately
 * conservative: a false negative merely hides an optional action, while a
 * false positive could repeat a user mutation.
 */
export function profileableReadSql(query: string): string | null {
  const trimmed = trimSqlComments(query);
  if (trimmed.length === 0 || !PROFILEABLE_QUERY_START.test(trimmed)) return null;
  if (countSqlStatements(trimmed) !== 1) return null;
  if (MUTATING_SQL_KEYWORDS.test(sqlCodeOnly(trimmed))) return null;
  return trimSqlComments(trimmed.replace(/;$/, ''));
}

/**
 * DuckDB's `SUMMARIZE` accepts a query by prefixing it (`SUMMARIZE SELECT …`),
 * not by wrapping it in parentheses.
 */
export function buildColumnProfileQuery(query: string): string | null {
  const withoutTrailingSemicolon = profileableReadSql(query);
  if (withoutTrailingSemicolon === null) return null;

  // Wrap SUMMARIZE in a subquery to project a stable column set AND cast
  // null_percentage: SUMMARIZE emits it as DECIMAL(9,2), which arrives from
  // Arrow as a value object the presentation mapper cannot render (the Nulls
  // metric showed an em dash for every column). DOUBLE survives the mapping.
  const profileQuery = `SELECT column_name, column_type, min, max, approx_unique, avg, std, CAST(null_percentage AS DOUBLE) AS null_percentage FROM (SUMMARIZE ${withoutTrailingSemicolon})`;
  return utf8ByteLength(profileQuery) <= MAX_QUERY_BYTES ? profileQuery : null;
}

/**
 * Profile a read query through the same capped, time-bounded DuckDB client as
 * ordinary SQL execution. The caller owns the UI state and decides whether to
 * retry; this helper never persists the derived result.
 */
export async function profileSqlQuery(
  query: string,
  options: ExecuteQueryOptions = {}
): Promise<SqlColumnProfileOutcome> {
  const profileQuery = buildColumnProfileQuery(query);
  if (profileQuery === null) return { status: 'not-profileable' };

  const outcome = await executeQuery(profileQuery, options);
  if (outcome.status !== 'success' && outcome.status !== 'too-large') {
    return {
      status: outcome.status,
      ...(outcome.errorMessage !== undefined
        ? { errorMessage: outcome.errorMessage }
        : {}),
    };
  }

  return {
    status: outcome.status,
    profiles: outcome.rows.map(toSqlColumnProfile),
    tooLarge: outcome.tooLarge,
  };
}

function toSqlColumnProfile(row: Record<string, unknown>): SqlColumnProfile {
  return {
    columnName: valueToText(row.column_name) ?? '',
    columnType: valueToText(row.column_type) ?? 'unknown',
    min: valueToText(row.min),
    max: valueToText(row.max),
    approximateUnique: valueToText(row.approx_unique),
    average: valueToText(row.avg),
    standardDeviation: valueToText(row.std),
    nullPercentage: valueToText(row.null_percentage),
  };
}

function valueToText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

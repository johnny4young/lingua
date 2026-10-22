import { SQL_QUERY_STATUSES, type SqlQueryStatus } from './sqlWorkspace';
import { utf8ByteLength } from './utf8';

/** One run in the SQL history: what ran, how it ended, never its rows. */
export interface SqlHistoryEntryV1 {
  version: 1;
  id: string;
  /** The query the run came from, when it still exists. */
  queryId?: string;
  /** The database connection it ran on; absent means Local, as for every entry before connections. */
  connectionId?: string;
  /** The SQL that ran, capped at `MAX_SQL_HISTORY_SQL_BYTES`. */
  sql: string;
  /** True when `sql` was cut at the cap. */
  truncated?: boolean;
  status: SqlQueryStatus;
  durationMs: number;
  rowCount: number;
  recordedAt: string;
}

export const MAX_SQL_HISTORY_ENTRIES = 200;
export const MAX_SQL_HISTORY_SQL_BYTES = 4 * 1024;

/** Cuts SQL to the history cap on a character boundary. */
export function capHistorySql(sql: string): { sql: string; truncated: boolean } {
  if (utf8ByteLength(sql) <= MAX_SQL_HISTORY_SQL_BYTES) return { sql, truncated: false };
  let bytes = 0;
  let end = 0;
  for (const char of sql) {
    const size = utf8ByteLength(char);
    if (bytes + size > MAX_SQL_HISTORY_SQL_BYTES) break;
    bytes += size;
    end += char.length;
  }
  return { sql: sql.slice(0, end), truncated: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Null on any shape mismatch, so a hand-edited store drops the entry instead of failing. */
export function parseSqlHistoryEntry(value: unknown): SqlHistoryEntryV1 | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.sql !== 'string') return null;
  if (!(SQL_QUERY_STATUSES as readonly string[]).includes(value.status as string)) return null;
  const durationMs = value.durationMs;
  const rowCount = value.rowCount;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (typeof rowCount !== 'number' || !Number.isFinite(rowCount) || rowCount < 0) return null;
  if (typeof value.recordedAt !== 'string') return null;
  const capped = capHistorySql(value.sql);
  return {
    version: 1,
    id: value.id,
    ...(typeof value.queryId === 'string' ? { queryId: value.queryId } : {}),
    ...(typeof value.connectionId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.connectionId) ? { connectionId: value.connectionId } : {}),
    sql: capped.sql,
    ...(capped.truncated || value.truncated === true ? { truncated: true } : {}),
    status: value.status as SqlQueryStatus,
    durationMs,
    rowCount,
    recordedAt: value.recordedAt,
  };
}

/** The runs of one connection (Local when `connectionId` is unset) whose SQL contains the search, ignoring case. */
export function filterSqlHistory(
  entries: ReadonlyArray<SqlHistoryEntryV1>,
  search: string,
  connectionId?: string
): SqlHistoryEntryV1[] {
  const needle = search.trim().toLowerCase();
  return entries.filter((entry) => entry.connectionId === connectionId && (needle.length === 0 || entry.sql.toLowerCase().includes(needle)));
}

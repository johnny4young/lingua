import type { SqlHistoryEntryV1 } from '../../../shared/sqlHistory';

/** The newest run's duration per query, from a newest-first history. */
export function lastDurationByQuery(history: ReadonlyArray<SqlHistoryEntryV1>): ReadonlyMap<string, number> {
  const durations = new Map<string, number>();
  for (const entry of history) {
    if (entry.queryId !== undefined && !durations.has(entry.queryId)) durations.set(entry.queryId, entry.durationMs);
  }
  return durations;
}

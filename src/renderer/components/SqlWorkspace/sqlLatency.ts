import type { SqlHistoryEntryV1 } from '../../../shared/sqlHistory';

/** Square-root scale, so one slow run does not flatten every other bar to a dot. */
export function latencyShare(durationMs: number, maxMs: number): number {
  if (!(maxMs > 0) || !(durationMs > 0)) return 0;
  return Math.min(1, Math.sqrt(durationMs / maxMs));
}

/** The largest duration in a list, for the bars' shared scale. */
export const maxDuration = (durations: Iterable<number>) => {
  let max = 0;
  for (const duration of durations) if (duration > max) max = duration;
  return max;
};

/** The newest run's duration per query, from a newest-first history. */
export function lastDurationByQuery(history: ReadonlyArray<SqlHistoryEntryV1>): ReadonlyMap<string, number> {
  const durations = new Map<string, number>();
  for (const entry of history) {
    if (entry.queryId !== undefined && !durations.has(entry.queryId)) durations.set(entry.queryId, entry.durationMs);
  }
  return durations;
}

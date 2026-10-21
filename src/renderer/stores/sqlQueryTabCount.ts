/**
 * Open SQL query tabs count toward the Free tab budget. The SQL store is
 * lazy, so until it loads the count comes from its persisted slice.
 */

const SQL_STORE_KEY = 'lingua-workspace-sql-state';

let liveCounter: (() => number) | null = null;

export function registerSqlQueryTabCounter(counter: (() => number) | null): void {
  liveCounter = counter;
}

function persistedCount(): number {
  try {
    const raw = localStorage.getItem(SQL_STORE_KEY);
    if (!raw) return 0;
    const state = (JSON.parse(raw) as { state?: { openQueryIds?: unknown; activeQueryId?: unknown } })
      .state;
    if (Array.isArray(state?.openQueryIds)) return state.openQueryIds.length;
    // Stores from before query tabs open only the active query.
    return typeof state?.activeQueryId === 'string' ? 1 : 0;
  } catch {
    return 0;
  }
}

export function sqlQueryTabCount(): number {
  return liveCounter ? liveCounter() : persistedCount();
}

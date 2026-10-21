/**
 * Handles on the lazy SQL store for code that must not load it: the Free
 * tab budget counts its open query tabs (from the persisted slice until
 * it loads), and Clear everything resets its live copy.
 */

export const SQL_WORKSPACE_STORAGE_KEY = 'lingua-workspace-sql-state';

let liveCounter: (() => number) | null = null;
let liveClear: (() => void) | null = null;

export function registerSqlStoreClear(clear: (() => void) | null): void {
  liveClear = clear;
}

/** Resets the loaded SQL store before its key is removed, so it cannot write the data back. */
export function clearLiveSqlStore(): void {
  liveClear?.();
}

export function registerSqlQueryTabCounter(counter: (() => number) | null): void {
  liveCounter = counter;
}

function persistedCount(): number {
  try {
    const raw = localStorage.getItem(SQL_WORKSPACE_STORAGE_KEY);
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

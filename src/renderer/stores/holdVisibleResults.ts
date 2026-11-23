import { useResultStore } from './resultStore';

/**
 * Same as `clearVisibleResults`, but the answers on screen stay as `keptAnswers`
 * for a run of `tabId`. Kept out of the store so the startup bundle does not carry it.
 */
export function holdVisibleResults(tabId: string): void {
  const state = useResultStore.getState();
  const { lineResults, lineTimings, keptAnswers, ranCode, clearVisibleResults } = state;
  const run = state.tabRuns[tabId]?.count ?? 0;
  const fresh = ranCode?.tabId === tabId && run > 0 && (lineResults.length > 0 || lineTimings.length > 0);
  // Called before this run marks itself running: a run still in flight left its kept answers on screen.
  const inFlight = state.isAutoRunning || state.isManualRunning;
  const kept = fresh ? { tabId, run } : inFlight && keptAnswers?.tabId === tabId ? keptAnswers : null;
  clearVisibleResults();
  if (kept) useResultStore.setState({ keptAnswers: kept });
}

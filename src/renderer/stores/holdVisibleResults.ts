import { useResultStore, type LineResult, type RunAnswers } from './resultStore';

function sameResults(answers: RunAnswers | undefined, results: readonly LineResult[]): answers is RunAnswers {
  return (
    answers !== undefined &&
    answers.results.length === results.length &&
    answers.results.every((item, index) => item.line === results[index]!.line && item.value === results[index]!.value)
  );
}

/**
 * Same as `clearVisibleResults`, but the answers on screen stay as `keptAnswers`
 * for a run of `tabId`. Kept out of the store so the startup bundle does not carry it.
 */
export function holdVisibleResults(tabId: string): void {
  const state = useResultStore.getState();
  const { lineResults, lineTimings, keptAnswers, ranCode, clearVisibleResults } = state;
  // The run that published the answers on screen; a restored snapshot can be an earlier one than the last run.
  const recorded = state.tabAnswers[tabId];
  const run =
    [recorded?.latest, recorded?.previous].find(answers => sameResults(answers, lineResults))?.number ?? state.tabRuns[tabId]?.count ?? 0;
  const fresh = ranCode?.tabId === tabId && run > 0 && (lineResults.length > 0 || lineTimings.length > 0);
  // Only a superseded auto-run can still be in flight; a manual run is already marked running by its session.
  const inFlight = state.isAutoRunning;
  const kept = fresh ? { tabId, run } : inFlight && keptAnswers?.tabId === tabId ? keptAnswers : null;
  clearVisibleResults();
  if (kept) useResultStore.setState({ keptAnswers: kept });
}

import { useEditorStore } from './editorStore';
import { useResultStore } from './resultStore';

let watchingTabs = false;

function without<T>(record: Record<string, T>, gone: (tabId: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([tabId]) => !gone(tabId)));
}

/**
 * Answers and the run log go with their tab. Started by the lazy run and answer modules, so the startup bundle does not carry it.
 * The run log drops only tabs that closed: a synthetic run's tab was never open and keeps counting.
 */
export function dropRunStateWithItsTab(): void {
  if (watchingTabs) return;
  watchingTabs = true;
  useEditorStore.subscribe((state, previous) => {
    // Typing rebuilds the tab list; only a change of tab ids can close one.
    if (state.tabs.length === previous.tabs.length && state.tabs.every((tab, index) => tab.id === previous.tabs[index]!.id)) return;
    const open = new Set(state.tabs.map(tab => tab.id));
    const closed = new Set(previous.tabs.filter(tab => !open.has(tab.id)).map(tab => tab.id));
    const { tabAnswers, tabRuns } = useResultStore.getState();
    const answersGone = Object.keys(tabAnswers).some(tabId => !open.has(tabId));
    const runsGone = Object.keys(tabRuns).some(tabId => closed.has(tabId));
    if (!answersGone && !runsGone) return;
    useResultStore.setState({
      ...(answersGone ? { tabAnswers: without(tabAnswers, tabId => !open.has(tabId)) } : {}),
      ...(runsGone ? { tabRuns: without(tabRuns, tabId => closed.has(tabId)) } : {}),
    });
  });
}

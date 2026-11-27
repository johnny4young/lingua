import { create } from 'zustand';
import type { LiveRunSnapshot } from '../../shared/liveRun';

/** The latest snapshot of a tab's run in flight. */
interface LiveRun {
  readonly runId: string;
  readonly live: LiveRunSnapshot;
}

interface LiveRunState {
  readonly byTab: Readonly<Record<string, LiveRun>>;
  publish: (tabId: string, runId: string, live: LiveRunSnapshot) => void;
  /** Ends the tab's live state, only while it still belongs to `runId`. */
  clear: (tabId: string, runId: string) => void;
}

/** Session state only: a run's position while it goes, dropped when it settles. */
export const useLiveRunStore = create<LiveRunState>(set => ({
  byTab: {},
  publish: (tabId, runId, live) =>
    set(state => ({ byTab: { ...state.byTab, [tabId]: { runId, live } } })),
  clear: (tabId, runId) =>
    set(state => {
      if (state.byTab[tabId]?.runId !== runId) return state;
      const byTab = { ...state.byTab };
      delete byTab[tabId];
      return { byTab };
    }),
}));

let runs = 0;

/** Live reporting for one editor run of `tabId`: hand `onLive` to the runner, and `end` once the run settles. */
export function reportLiveRun(tabId: string): { readonly onLive: (live: LiveRunSnapshot) => void; readonly end: () => void } {
  const runId = String(++runs);
  return {
    onLive: live => useLiveRunStore.getState().publish(tabId, runId, live),
    end: () => useLiveRunStore.getState().clear(tabId, runId),
  };
}

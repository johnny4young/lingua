import { create } from 'zustand';
import type { ChatMessage } from '../../shared/ai/explainError';

/** The error the anchored explain panel is about. */
export interface ExplainTarget {
  tabId: string;
  errorMessage: string;
  /** 1-based line of the error in the tab, when the runtime reported one. */
  line: number | null;
  column: number | null;
}

interface ExplainThreads {
  errorMessage: string;
  /** Keyed by the endpoint each payload was approved for; a new endpoint starts from the preview. */
  byEndpoint: Record<string, readonly ChatMessage[]>;
}

interface ExplainPanelState {
  target: ExplainTarget | null;
  /** A pinned panel stays open when the next run changes or clears the error. */
  pinned: boolean;
  /** One conversation per tab and endpoint, in memory only, so code never reaches storage. */
  threads: Record<string, ExplainThreads>;
  open: (target: ExplainTarget) => void;
  close: () => void;
  setPinned: (pinned: boolean) => void;
  saveThread: (tabId: string, errorMessage: string, endpoint: string, transcript: readonly ChatMessage[]) => void;
  /** The thread for this error in this tab and endpoint, or none when either changed. */
  threadFor: (tabId: string, errorMessage: string, endpoint: string) => readonly ChatMessage[];
  /** Forget the threads of tabs that are no longer open. */
  keepThreads: (openTabIds: readonly string[]) => void;
}

export const useExplainPanelStore = create<ExplainPanelState>()((set, get) => ({
  target: null,
  pinned: false,
  threads: {},
  open: (target) => set({ target }),
  close: () => set({ target: null, pinned: false }),
  setPinned: (pinned) => set({ pinned }),
  saveThread: (tabId, errorMessage, endpoint, transcript) =>
    set((state) => {
      const current = state.threads[tabId];
      const byEndpoint = current?.errorMessage === errorMessage ? current.byEndpoint : {};
      return { threads: { ...state.threads, [tabId]: { errorMessage, byEndpoint: { ...byEndpoint, [endpoint]: transcript } } } };
    }),
  threadFor: (tabId, errorMessage, endpoint) => {
    const threads = get().threads[tabId];
    return threads?.errorMessage === errorMessage ? (threads.byEndpoint[endpoint] ?? []) : [];
  },
  keepThreads: (openTabIds) =>
    set((state) => {
      const kept = Object.fromEntries(Object.entries(state.threads).filter(([tabId]) => openTabIds.includes(tabId)));
      const target = state.target && openTabIds.includes(state.target.tabId) ? state.target : null;
      return Object.keys(kept).length === Object.keys(state.threads).length && target === state.target
        ? state
        : { threads: kept, target, pinned: target ? state.pinned : false };
    }),
}));

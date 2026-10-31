import { create } from 'zustand';
import type { RunRegion } from '../utils/runRegions';

interface RunRegionResult {
  tabId: string;
  region: RunRegion;
  ranAt: number;
  executionTime: number | null;
  ok: boolean;
  message: string;
}

interface RunRegionState {
  /** The latest region run, in memory only; any other run of its tab clears it. */
  last: RunRegionResult | null;
  publish: (result: RunRegionResult) => void;
  clearTab: (tabId: string) => void;
}

export const useRunRegionStore = create<RunRegionState>()((set, get) => ({
  last: null,
  publish: result => set({ last: result }),
  clearTab: tabId => {
    if (get().last?.tabId === tabId) set({ last: null });
  },
}));

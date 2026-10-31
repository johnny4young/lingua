import { create } from 'zustand';
import type { RunRegion } from '../utils/runRegions';
import type { LineResult } from './resultStore';

interface RunRegionResult {
  tabId: string;
  region: RunRegion;
  ranAt: number;
  executionTime: number | null;
  ok: boolean;
  message: string;
  /** The run's values on the region's lines, kept so a later run or edit cannot swap them. */
  rows: LineResult[];
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

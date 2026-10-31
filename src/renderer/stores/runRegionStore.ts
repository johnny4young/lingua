import { create } from 'zustand';
import type { ExecutionResult } from '../types/execution';
import type { MaskedStdinAnswer, RunRegion } from '../utils/runRegions';
import type { LineResult } from './resultStore';

type StdinRequest = NonNullable<ExecutionResult['stdinRequest']>;

interface RunRegionResult {
  tabId: string;
  region: RunRegion;
  ranAt: number;
  executionTime: number | null;
  ok: boolean;
  message: string;
  /** The run's values on the region's lines, kept so a later run or edit cannot swap them. */
  rows: LineResult[];
  /** The prompt the run stopped at because stdin had no line left. */
  request?: StdinRequest;
}

interface RunRegionState {
  /** The latest region run, in memory only; any other run of its tab clears it. */
  last: RunRegionResult | null;
  /** Masked stdin answers per tab, in memory only and never written to the tab. */
  masked: Record<string, MaskedStdinAnswer[]>;
  publish: (result: RunRegionResult) => void;
  clearTab: (tabId: string) => void;
  addMasked: (tabId: string, answer: MaskedStdinAnswer) => void;
}

export const useRunRegionStore = create<RunRegionState>()((set, get) => ({
  last: null,
  masked: {},
  publish: result => set({ last: result }),
  clearTab: tabId => {
    if (get().last?.tabId === tabId) set({ last: null });
  },
  addMasked: (tabId, answer) => set(state => ({ masked: { ...state.masked, [tabId]: [...(state.masked[tabId] ?? []), answer] } })),
}));

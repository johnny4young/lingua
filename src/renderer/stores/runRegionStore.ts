import { create } from 'zustand';
import type { ExecutionResult } from '../types/execution';
import type { MaskedStdinAnswer, RunRegion } from '../utils/runRegions';
import { useEditorStore } from './editorStore';
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

/** Masked answers with the tab Input and code they were placed against; any other edit to either drops them. */
interface MaskedStdin {
  input: string;
  content: string;
  answers: MaskedStdinAnswer[];
}

interface RunRegionState {
  /** The latest region run, in memory only; any other run of its tab clears it. */
  last: RunRegionResult | null;
  /** Masked stdin answers per tab, in memory only and never written to the tab. */
  masked: Record<string, MaskedStdin>;
  publish: (result: RunRegionResult) => void;
  clearTab: (tabId: string) => void;
  addMasked: (tabId: string, answer: MaskedStdinAnswer, input: string, content: string) => void;
  /** Records the Input a plain answer just produced, so the masked answers stay in place. */
  followInput: (tabId: string, input: string) => void;
  /** The masked answers for a tab, or none once its Input or code changed behind them. */
  maskedFor: (tabId: string, input: string, content: string) => MaskedStdinAnswer[];
}

let watchingTabs = false;

/** Masked answers leave memory with their tab. */
function dropMaskedWithItsTab(): void {
  if (watchingTabs) return;
  watchingTabs = true;
  useEditorStore.subscribe(state => {
    const { masked } = useRunRegionStore.getState();
    const gone = Object.keys(masked).filter(tabId => !state.tabs.some(tab => tab.id === tabId));
    if (gone.length === 0) return;
    const kept = { ...masked };
    for (const tabId of gone) delete kept[tabId];
    useRunRegionStore.setState({ masked: kept });
  });
}

export const useRunRegionStore = create<RunRegionState>()((set, get) => ({
  last: null,
  masked: {},
  publish: result => set({ last: result }),
  clearTab: tabId => {
    if (get().last?.tabId === tabId) set({ last: null });
  },
  addMasked: (tabId, answer, input, content) => {
    dropMaskedWithItsTab();
    set(state => ({ masked: { ...state.masked, [tabId]: { input, content, answers: [...get().maskedFor(tabId, input, content), answer] } } }));
  },
  followInput: (tabId, input) => {
    const entry = get().masked[tabId];
    if (entry) set(state => ({ masked: { ...state.masked, [tabId]: { ...entry, input } } }));
  },
  maskedFor: (tabId, input, content) => {
    const entry = get().masked[tabId];
    return entry && entry.input === input && entry.content === content ? entry.answers : [];
  },
}));

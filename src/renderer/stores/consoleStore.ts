import { create } from 'zustand';
import type {
  ConsoleState,
  ConsoleEntry,
  ConsoleEntryType,
  ConsolePayloadKindFilter,
} from '../types';

let entryCounter = 0;

const ALL_TYPES: ConsoleEntryType[] = ['log', 'info', 'warn', 'error', 'result'];

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  activeFilters: new Set<ConsoleEntryType>(ALL_TYPES),
  // RL-044 Slice 1B fold A — payload-kind chip filter. Empty by
  // default so users never lose visibility on payload kinds they
  // haven't explicitly chosen to hide.
  hiddenPayloadKinds: new Set<ConsolePayloadKindFilter>(),
  showTimestamps: true,

  addEntry: (entry) => {
    entryCounter++;
    // Spread carries the additive `payload?` field through to the
    // stored ConsoleEntry — additive, never overwriting `content`.
    const newEntry: ConsoleEntry = {
      ...entry,
      id: `entry-${entryCounter}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      entries: [...state.entries, newEntry],
    }));
  },

  clear: () =>
    // RL-044 Slice 1B fold A — clearing the console also resets any
    // payload-kind filter chips the user had toggled off, so a fresh
    // run never displays "No entries match the active filters" against
    // stale filter state from a previous session.
    set({ entries: [], hiddenPayloadKinds: new Set() }),

  toggleFilter: (type: ConsoleEntryType) =>
    set((state) => {
      const next = new Set(state.activeFilters);
      if (next.has(type)) {
        // Keep at least one filter active
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return { activeFilters: next };
    }),

  togglePayloadKindFilter: (kind: ConsolePayloadKindFilter) =>
    set((state) => {
      const next = new Set(state.hiddenPayloadKinds);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return { hiddenPayloadKinds: next };
    }),

  clearPayloadKindFilters: () => set({ hiddenPayloadKinds: new Set() }),

  toggleTimestamps: () => set((state) => ({ showTimestamps: !state.showTimestamps })),
}));

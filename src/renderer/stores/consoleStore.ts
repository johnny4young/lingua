import { create } from 'zustand';
import type { ConsoleState, ConsoleEntry, ConsoleEntryType } from '../types';

let entryCounter = 0;

const ALL_TYPES: ConsoleEntryType[] = ['log', 'info', 'warn', 'error', 'result'];

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  activeFilters: new Set<ConsoleEntryType>(ALL_TYPES),
  showTimestamps: true,

  addEntry: (entry) => {
    entryCounter++;
    const newEntry: ConsoleEntry = {
      ...entry,
      id: `entry-${entryCounter}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      entries: [...state.entries, newEntry],
    }));
  },

  clear: () => set({ entries: [] }),

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

  toggleTimestamps: () => set((state) => ({ showTimestamps: !state.showTimestamps })),
}));

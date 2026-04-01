import { create } from 'zustand';
import type { ConsoleState, ConsoleEntry } from '../types';

let entryCounter = 0;

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],

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
}));

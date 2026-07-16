/**
 * RL-113 Slice 1 — per-session ring buffer of executed palette commands.
 *
 * Records the closed-enum ACTION ids the command palette executes so
 * Cmd+; can offer "run it again" without the open-palette → retype →
 * select roundtrip. Deliberately session-only (no persist middleware):
 * a recent-commands stack from last week is noise, and action ids are
 * rebuilt per render anyway (labels/availability come from the live
 * palette model, never from this store).
 *
 * Only `category: 'action'` entries are recorded — templates and
 * snippets have their own recall surfaces (Quick Open, the snippets
 * modal) and their ids are content-derived, not a closed enum.
 */

import { create } from 'zustand';

/** Hard cap on retained entries. FIFO eviction beyond this. */
export const MAX_COMMAND_HISTORY_ENTRIES = 20;

export interface CommandHistoryEntry {
  /** Palette action id (closed enum from the palette model builders). */
  id: string;
  /** Epoch ms of the execution, for the "2m ago" popover column. */
  executedAt: number;
}

interface CommandHistoryState {
  /** Newest first. Never exceeds {@link MAX_COMMAND_HISTORY_ENTRIES}. */
  entries: CommandHistoryEntry[];
  recordCommand: (id: string) => void;
  _clearForTesting: () => void;
}

export const useCommandHistoryStore = create<CommandHistoryState>(set => ({
  entries: [],

  recordCommand: id => {
    if (!id) return;
    set(state => {
      // Re-running the same command just refreshes its timestamp at the
      // top instead of flooding the stack with duplicates.
      const rest = state.entries.filter(entry => entry.id !== id);
      const next = [{ id, executedAt: Date.now() }, ...rest];
      return { entries: next.slice(0, MAX_COMMAND_HISTORY_ENTRIES) };
    });
  },

  _clearForTesting: () => set({ entries: [] }),
}));

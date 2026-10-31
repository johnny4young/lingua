/**
 * Capsules the user opened from Import this session. Memory only, never
 * persisted, so the capsule browser can list them as not run here.
 */

import { create } from 'zustand';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import { CAPSULE_LRU_CAP_PRO } from './executionHistoryStore';

export interface ImportedCapsuleEntry {
  id: string;
  capsule: RunCapsuleV1;
  importedAt: number;
}

interface ImportedCapsuleState {
  /** Oldest first, like the execution history. */
  entries: readonly ImportedCapsuleEntry[];
  /** Re-importing the same capsule moves it to the newest slot. */
  add: (capsule: RunCapsuleV1) => void;
  remove: (id: string) => void;
  /** Puts a removed entry back where it was; no-op when it is already listed. */
  restore: (entry: ImportedCapsuleEntry, index: number) => void;
}

export const useImportedCapsuleStore = create<ImportedCapsuleState>()((set) => ({
  entries: [],
  add: (capsule) =>
    set((state) => {
      const kept = state.entries.filter((entry) => entry.capsule.capsuleId !== capsule.capsuleId);
      const next = [...kept, { id: `imported-${capsule.capsuleId}`, capsule, importedAt: Date.now() }];
      return { entries: next.slice(-CAPSULE_LRU_CAP_PRO) };
    }),
  remove: (id) => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
  restore: (entry, index) =>
    set((state) => {
      if (state.entries.some((existing) => existing.id === entry.id)) return state;
      const next = [...state.entries];
      next.splice(Math.min(index, next.length), 0, entry);
      return { entries: next.slice(-CAPSULE_LRU_CAP_PRO) };
    }),
}));

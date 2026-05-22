/**
 * RL-025 Slice A - non-persisted dependency detection cache.
 *
 * Keyed by `tabId`. Memoised by a cheap `detectionHash` (length plus
 * a fold over the whole capped buffer) so re-detection
 * only runs when the buffer actually changed. Cleared on tab close
 * via `editorStore.removeTab`.
 *
 * No persistence on purpose - detection state is purely a function
 * of the in-memory buffer; rehydrating from localStorage would
 * surface stale rows for a buffer the user has since edited.
 */

import { create } from 'zustand';
import type {
  DependencyAdapterLanguage,
  DependencyStatus,
  DetectedDependency,
} from '../../shared/dependencies/types';

export interface ClassifiedDependency extends DetectedDependency {
  readonly status: DependencyStatus;
}

export interface TabDetectionState {
  readonly tabId: string;
  readonly language: DependencyAdapterLanguage;
  readonly detectionHash: string;
  readonly dependencies: readonly ClassifiedDependency[];
  readonly classifiedAt: number;
  /**
   * Soft warning surfaced by the panel when the detector skipped
   * the buffer for being too large (see
   * `DEPENDENCY_DETECTION_MAX_BUFFER_BYTES`).
   */
  readonly skippedReason?: 'buffer-too-large';
}

interface DependencyDetectionStateShape {
  readonly byTab: ReadonlyMap<string, TabDetectionState>;
  setDetection: (tabId: string, next: TabDetectionState) => void;
  evictTab: (tabId: string) => void;
  clear: () => void;
}

export const useDependencyDetectionStore = create<DependencyDetectionStateShape>(
  (set) => ({
    byTab: new Map(),
    setDetection: (tabId, next) =>
      set((state) => {
        const updated = new Map(state.byTab);
        updated.set(tabId, next);
        return { byTab: updated };
      }),
    evictTab: (tabId) =>
      set((state) => {
        if (!state.byTab.has(tabId)) return state;
        const updated = new Map(state.byTab);
        updated.delete(tabId);
        return { byTab: updated };
      }),
    clear: () =>
      set((state) => {
        if (state.byTab.size === 0) return state;
        return { byTab: new Map() };
      }),
  })
);

/**
 * Cheap content fingerprint. The detector is capped at 500 KB, so a
 * full linear fold is still small next to the parse pass and avoids
 * stale rows when an import changes in the middle of a same-length
 * buffer.
 */
export function computeDetectionHash(language: string, source: string): string {
  if (typeof source !== 'string') return `${language}|0|empty`;
  const len = source.length;
  if (len === 0) return `${language}|0|empty`;
  let fold = 0x811c9dc5;
  for (let i = 0; i < len; i += 1) {
    fold ^= source.charCodeAt(i);
    fold = Math.imul(fold, 0x01000193);
  }
  return `${language}|${len}|${(fold >>> 0).toString(36)}`;
}

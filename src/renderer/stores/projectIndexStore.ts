import { create } from 'zustand';
import type { Language } from '../types';
import { languageFromPath } from '../utils/language';

export interface ProjectIndexEntry {
  name: string;
  /** Path relative to the active project root. */
  relativePath: string;
  language?: Language;
}

export type ProjectIndexStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ProjectIndexState {
  /** Capability id of the project the current index belongs to, if any. */
  rootId: string | null;
  status: ProjectIndexStatus;
  entries: ProjectIndexEntry[];
  lastIndexedAt: number | null;
  error: string | null;
  /** Build (or rebuild) the index for the active project root. */
  refresh: (rootId: string) => Promise<void>;
  /** Drop the index — called when no project is active. */
  clear: () => void;
}

function decorateEntries(raw: FsIndexedFile[]): ProjectIndexEntry[] {
  return raw.map((file) => ({
    name: file.name,
    relativePath: file.relativePath,
    language: languageFromPath(file.name),
  }));
}

export const useProjectIndexStore = create<ProjectIndexState>((set, get) => ({
  rootId: null,
  status: 'idle',
  entries: [],
  lastIndexedAt: null,
  error: null,

  refresh: async (rootId) => {
    const listAllFiles = window.lingua?.fs?.listAllFiles;
    if (!listAllFiles) {
      // Runtime has no full-index IPC (e.g. legacy web adapters). Keep the
      // store idle so the Quick Open consumer falls back to the tree walk.
      set({ rootId, status: 'idle', entries: [], error: null });
      return;
    }

    // Skip redundant refreshes while an index is already loading for the same
    // root — every open-project flow triggers this path multiple times (tree
    // load + watch events) and we don't want concurrent walks.
    const current = get();
    if (current.status === 'loading' && current.rootId === rootId) {
      return;
    }

    set({ rootId, status: 'loading', error: null });

    try {
      const raw = await listAllFiles(rootId, '');
      // Guard against stale responses: if the user switched projects mid-walk,
      // drop this result and keep whatever the newer walk produced.
      if (get().rootId !== rootId) return;
      set({
        rootId,
        status: 'ready',
        entries: decorateEntries(raw),
        lastIndexedAt: Date.now(),
        error: null,
      });
    } catch (err) {
      if (get().rootId !== rootId) return;
      set({
        rootId,
        status: 'error',
        entries: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clear: () => {
    set({
      rootId: null,
      status: 'idle',
      entries: [],
      lastIndexedAt: null,
      error: null,
    });
  },
}));

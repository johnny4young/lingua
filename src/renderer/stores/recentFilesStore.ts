import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { createMigrate } from './persistence/migrationRegistry';

// Keep Quick Open useful without turning localStorage into a long-lived file
// history ledger. The newest entry is always first.
const MAX_RECENT_FILES = 20;

export interface RecentFile {
  filePath: string;
  name: string;
  language: Language;
  openedAt: number;
}

interface RecentFilesState {
  recentFiles: RecentFile[];
  addRecentFile: (file: Omit<RecentFile, 'openedAt'>) => void;
  removeRecentFile: (filePath: string) => void;
  clearRecentFiles: () => void;
}

export const useRecentFilesStore = create<RecentFilesState>()(
  persist(
    (set) => ({
      recentFiles: [],

      addRecentFile: (file) =>
        set((state) => {
          // Deduplicate by absolute file path, then move the file to the top
          // with a fresh timestamp so repeated opens refresh recency.
          const filtered = state.recentFiles.filter(
            (f) => f.filePath !== file.filePath
          );
          const entry: RecentFile = { ...file, openedAt: Date.now() };
          return {
            recentFiles: [entry, ...filtered].slice(0, MAX_RECENT_FILES),
          };
        }),

      removeRecentFile: (filePath) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter((f) => f.filePath !== filePath),
        })),

      clearRecentFiles: () => set({ recentFiles: [] }),
    }),
    {
      name: 'lingua-recent-files',
      version: 1,
      migrate: createMigrate('lingua-recent-files'),
      // Persist only the serializable list; store actions are recreated by
      // Zustand at startup and should never be stored in localStorage.
      partialize: (state) => ({ recentFiles: state.recentFiles }),
    }
  )
);

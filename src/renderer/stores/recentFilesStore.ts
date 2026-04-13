import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';

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
      partialize: (state) => ({ recentFiles: state.recentFiles }),
    }
  )
);

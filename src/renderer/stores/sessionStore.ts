import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { useEditorStore } from './editorStore';
import { resolveFileLanguageOrPlaintext } from '../utils/language';

interface SessionTab {
  name: string;
  language: Language;
  /** Content for in-memory tabs; empty string for disk-backed tabs (re-read on restore). */
  content: string;
  filePath?: string;
}

interface SessionState {
  savedTabs: SessionTab[];
  savedActiveIndex: number;
  saveSession: () => void;
  restoreSession: () => Promise<void>;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      savedTabs: [],
      savedActiveIndex: -1,

      saveSession: () => {
        const { tabs, activeTabId } = useEditorStore.getState();
        const savedTabs: SessionTab[] = tabs.map((tab) => ({
          name: tab.name,
          language: tab.language,
          content: tab.filePath ? '' : tab.content,
          filePath: tab.filePath,
        }));
        const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
        set({ savedTabs, savedActiveIndex: activeIndex });
      },

      restoreSession: async () => {
        const { savedTabs, savedActiveIndex } = get();
        if (savedTabs.length === 0) return;

        const restored: Array<Parameters<ReturnType<typeof useEditorStore.getState>['restoreTabs']>[0][number] & {
          id: string;
        }> = [];

        for (const saved of savedTabs) {
          let content = saved.content;
          if (saved.filePath) {
            try {
              content = await window.lingua.fs.read(saved.filePath);
            } catch {
              // File no longer exists — restore with empty content
              content = `// File not found: ${saved.filePath}\n`;
            }
          }

          const language = saved.filePath
            ? resolveFileLanguageOrPlaintext(saved.filePath)
            : saved.language;

          restored.push({
            id: crypto.randomUUID(),
            name: saved.name,
            language,
            content,
            filePath: saved.filePath,
          });
        }

        // Bypass the RL-060 tier ceiling — restoring a prior session must
        // grandfather the user's workspace, not truncate it.
        const activeId = restored[savedActiveIndex]?.id ?? null;
        useEditorStore.getState().restoreTabs(restored, activeId);
      },
    }),
    {
      name: 'lingua-session',
      partialize: (state) => ({
        savedTabs: state.savedTabs,
        savedActiveIndex: state.savedActiveIndex,
      }),
    }
  )
);

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { useEditorStore } from './editorStore';
import { languageFromPath } from '../utils/language';

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

        const { addTab, setActiveTab } = useEditorStore.getState();
        const tabIds: string[] = [];

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

          const id = crypto.randomUUID();
          const language = saved.filePath
            ? languageFromPath(saved.filePath)
            : saved.language;

          addTab({
            id,
            name: saved.name,
            language,
            content,
            filePath: saved.filePath,
          });
          tabIds.push(id);
        }

        const activeId = tabIds[savedActiveIndex];
        if (activeId) {
          setActiveTab(activeId);
        }
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

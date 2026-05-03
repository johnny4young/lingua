import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { useEditorStore } from './editorStore';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { parentDirOf } from '../utils/filePath';

interface SessionTab {
  name: string;
  language: Language;
  /** Content for in-memory tabs; empty string for disk-backed tabs (re-read on restore). */
  content: string;
  /**
   * Display absolute path. Used at restore time to re-mint a capability
   * for the file's parent directory via `fs:reopen-root` so the tab can
   * read its own content under the new IPC contract. Never sent to a
   * filesystem IPC handler directly.
   */
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
          // Disk-backed tabs persist only the path; restore re-reads via
          // a freshly minted capability so we never persist file content
          // we are about to re-fetch anyway. Untitled tabs persist their
          // content so the user does not lose unsaved work.
          content: tab.filePath ? '' : tab.content,
          filePath: tab.filePath,
        }));
        const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
        set({ savedTabs, savedActiveIndex: activeIndex });
      },

      restoreSession: async () => {
        const { savedTabs, savedActiveIndex } = get();
        if (savedTabs.length === 0) return;

        const restored: Array<
          Parameters<ReturnType<typeof useEditorStore.getState>['restoreTabs']>[0][number] & {
            id: string;
          }
        > = [];

        for (const saved of savedTabs) {
          let content = saved.content;
          let rootId: string | undefined;
          let relativePath: string | undefined;

          if (saved.filePath) {
            // RL-077 — re-mint a capability for the persisted tab's parent
            // directory and read the file under the new contract. If the
            // mint fails (path no longer exists, denylisted, not a dir),
            // fall through with empty content so the user does not lose
            // the tab outright.
            const { parent, basename } = parentDirOf(saved.filePath);
            try {
              const reopen = await window.lingua.fs.reopenRoot(parent);
              if (reopen.ok) {
                rootId = reopen.rootId;
                relativePath = basename;
                content = await window.lingua.fs.read(rootId, relativePath);
              } else {
                content = `// File not found: ${saved.name}\n`;
              }
            } catch {
              content = `// File not found: ${saved.name}\n`;
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
            rootId,
            relativePath,
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

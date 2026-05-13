import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { useEditorStore } from './editorStore';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { coerceRuntimeMode, type RuntimeMode } from '../../shared/runtimeModes';

interface SessionTab {
  name: string;
  language: Language;
  /** Content for in-memory tabs; empty string for disk-backed tabs (re-read on restore). */
  content: string;
  /**
   * Display absolute path. Used at restore time only as an approval
   * lookup key for `fs:reopen-file`; the renderer never performs disk
   * I/O against this path directly.
   */
  filePath?: string;
  /**
   * RL-019 Slice 1 — per-tab runtime mode for JS/TS tabs. Missing /
   * unknown values are coerced back to `'worker'` for JS/TS at
   * restore time via `coerceRuntimeMode`, so a tampered or
   * pre-Slice-1 session entry never lands in an unimplemented mode.
   */
  runtimeMode?: RuntimeMode;
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
          // RL-019 Slice 1 — persist the runtime mode alongside the
          // tab. Non-JS/TS tabs have `runtimeMode === undefined`, so
          // the field is omitted from the serialized output.
          runtimeMode: tab.runtimeMode,
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
            // RL-077 — re-mint a single-file capability for the
            // persisted tab. If the mint fails (path no longer exists,
            // denied, or not approved), fall through with empty content
            // so the user does not lose the tab outright.
            try {
              const reopen = await window.lingua.fs.reopenFile(saved.filePath);
              if (reopen.ok) {
                rootId = reopen.rootId;
                relativePath = reopen.fileRelativePath;
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

          // RL-019 Slice 1 — restore the runtime mode for JS/TS
          // tabs, coercing missing / unknown / unimplemented values
          // back to `'worker'`. Non-JS/TS tabs always coerce to
          // `null`, so the spread below leaves `runtimeMode`
          // undefined on the restored FileTab.
          const restoredRuntimeMode = coerceRuntimeMode(saved.runtimeMode, language);

          restored.push({
            id: crypto.randomUUID(),
            name: saved.name,
            language,
            content,
            filePath: saved.filePath,
            rootId,
            relativePath,
            ...(restoredRuntimeMode !== null ? { runtimeMode: restoredRuntimeMode } : {}),
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

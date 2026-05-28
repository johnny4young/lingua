import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { useEditorStore } from './editorStore';
import { useRecipeStore } from './recipeStore';
import { useUIStore } from './uiStore';
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
  /**
   * RL-020 Slice 6 fold A — per-tab pre-set stdin buffer. Persisted
   * so a tab that ships an `input()` example survives a reload
   * alongside the editor content. Restored only for tabs whose
   * resolved language still supports stdin (JS / TS / Python); the
   * editorStore drops the field on rename / restore for any other
   * language.
   */
  stdinBuffer?: string;
  /**
   * RL-039 Slice B — persisted recipe binding for tabs opened from
   * the Recipes overlay. Runtime run-results stay transient in
   * recipeStore; this id is enough to restore the prompt panel after
   * a reload.
   */
  recipeBindingId?: string;
  /**
   * RL-043 Slice A — discriminator flag persisted so the restore
   * path knows to route the tab through `<NotebookView>` instead of
   * the Monaco editor surface. The notebook payload itself lives in
   * the isolated `lingua-notebook-state` store keyed by the tab id
   * captured in `notebookTabId` below.
   */
  kind?: 'notebook';
  /**
   * RL-043 Slice A — original tabId captured at save time. Notebook
   * state in `useNotebookStore` is keyed by tabId; without this
   * field, restoring would mint a fresh UUID and orphan the
   * persisted notebook entry. Only populated when `kind === 'notebook'`.
   */
  notebookTabId?: string;
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
          // RL-020 Slice 6 fold A — persist the per-tab stdin buffer
          // so an exploration session that ships pre-set input
          // survives a reload. The editor store drops the field on
          // rename / restore for languages that don't support it,
          // so a tampered persisted entry can't leak the buffer onto
          // a Rust / Go / JSON tab.
          stdinBuffer: tab.stdinBuffer,
          recipeBindingId: tab.recipeBindingId,
          // RL-043 Slice A — preserve the notebook discriminator + the
          // original tabId so the per-tab notebook payload in
          // `useNotebookStore` survives a reload (the store is keyed
          // by tabId; without this, restore would mint a fresh UUID
          // and the persisted notebook would be orphaned).
          kind: tab.kind === 'notebook' ? 'notebook' : undefined,
          notebookTabId: tab.kind === 'notebook' ? tab.id : undefined,
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

          // RL-020 Slice 6 fold A — restore the buffer only when the
          // resolved language still supports stdin. The editorStore
          // restore path also drops it via `dropStdinIfUnsupported`,
          // but trimming here keeps the in-memory tab structure
          // honest about which fields are live.
          const stdinSupported =
            language === 'javascript' ||
            language === 'typescript' ||
            language === 'python';
          const restoredStdinBuffer =
            stdinSupported && typeof saved.stdinBuffer === 'string'
              ? saved.stdinBuffer
              : undefined;
          const restoredRecipeBindingId =
            language === 'javascript' &&
            typeof saved.recipeBindingId === 'string' &&
            saved.recipeBindingId.length > 0
              ? saved.recipeBindingId
              : undefined;

          // RL-043 Slice A — restore the notebook discriminator AND
          // reuse the original tabId so the per-tab notebook payload
          // in `useNotebookStore` (keyed by tabId) lines up with the
          // restored FileTab. If the saved entry is missing
          // `notebookTabId` or the notebook store has no entry under
          // that key (settings reset, manual localStorage purge), we
          // still restore the discriminator and let NotebookView
          // create a blank notebook on first render — better than
          // dropping the tab outright.
          const restoredAsNotebook =
            saved.kind === 'notebook' &&
            typeof saved.notebookTabId === 'string' &&
            saved.notebookTabId.length > 0;
          const restoredId = restoredAsNotebook
            ? saved.notebookTabId!
            : crypto.randomUUID();

          restored.push({
            id: restoredId,
            name: saved.name,
            language,
            content,
            filePath: saved.filePath,
            rootId,
            relativePath,
            ...(restoredRuntimeMode !== null ? { runtimeMode: restoredRuntimeMode } : {}),
            ...(restoredStdinBuffer !== undefined
              ? { stdinBuffer: restoredStdinBuffer }
              : {}),
            ...(restoredRecipeBindingId !== undefined
              ? { recipeBindingId: restoredRecipeBindingId }
              : {}),
            ...(restoredAsNotebook ? { kind: 'notebook' as const } : {}),
          });
        }

        // Bypass the RL-060 tier ceiling — restoring a prior session must
        // grandfather the user's workspace, not truncate it.
        const activeId = restored[savedActiveIndex]?.id ?? null;
        useEditorStore.getState().restoreTabs(restored, activeId);
        const recipeStore = useRecipeStore.getState();
        for (const tab of restored) {
          if (tab.recipeBindingId !== undefined) {
            recipeStore.bindRecipeToTab(tab.id, tab.recipeBindingId);
          }
        }
        const activeRestoredTab = restored.find((tab) => tab.id === activeId);
        if (activeRestoredTab?.recipeBindingId !== undefined) {
          useUIStore.getState().openBottomPanel('recipe');
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

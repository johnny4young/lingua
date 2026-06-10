/**
 * Persisted editor-session boundary.
 *
 * The store records only enough data to rebuild the visible workspace after a
 * reload: untitled tab content, disk-backed paths, active index, and stable ids
 * for surfaces whose data lives in their own persisted stores. Restore treats
 * the saved blob as stale/tamperable: disk tabs must re-mint file capabilities,
 * runtime modes are coerced through the shared enum guard, and legacy SQL/HTTP
 * workspace tabs collapse to the current one-tab-per-workspace model.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';
import { createMigrate } from './persistence/migrationRegistry';
import {
  useEditorStore,
  SQL_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_ID,
  UTILITIES_WORKSPACE_TAB_ID,
} from './editorStore';
import { useRecipeStore } from './recipeStore';
import { useUIStore } from './uiStore';
import { notifyBlockedPath } from '../utils/blockedPath';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { coerceRuntimeMode, type RuntimeMode } from '../../shared/runtimeModes';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import type { RelativePath, RootId } from '../../shared/fs/brandedIds';

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
   *
   * MOV.02 — widened to `'sql'` / `'http'`. MOV.03 adds
   * `'utilities'`. These route restore through full-screen workspace
   * tab surfaces instead of Monaco.
   *
   * SQL/HTTP MODEL rework — SQL and HTTP are now COLLECTION workspaces:
   * there is at most ONE SQL tab and ONE HTTP tab, each carrying a
   * stable constant id (`SQL_WORKSPACE_TAB_ID` / `HTTP_WORKSPACE_TAB_ID`).
   * The collection of queries/requests lives in `useWorkspaceSqlStore`
   * / `useWorkspaceToolStore` and rehydrates from its OWN localStorage
   * key, independent of the session tab. A session no longer encodes
   * per-query/request tabs; restore collapses any legacy duplicates to
   * the single workspace tab per kind (see `restoreSession`).
   */
  kind?: 'notebook' | 'sql' | 'http' | 'utilities';
  /**
   * RL-043 Slice A — original tabId captured at save time. Notebook
   * state in `useNotebookStore` is keyed by tabId; without this
   * field, restoring would mint a fresh UUID and orphan the
   * persisted notebook entry. Only populated when `kind === 'notebook'`.
   */
  notebookTabId?: string;
  /**
   * Original tabId captured at save time for SQL / HTTP / Utilities
   * workspace tabs.
   *
   * SQL/HTTP MODEL rework — the workspace tab now carries a stable
   * constant id, so saving always records that constant here and restore
   * reuses it. LEGACY sessions (pre-rework) recorded a per-query/request
   * UUID; restore tolerates those by collapsing every legacy `sql` /
   * `http` entry to the single stable workspace tab per kind. The
   * collection itself rehydrates from its own store key regardless, so
   * the legacy per-query id is no longer load-bearing for data recovery.
   * Only populated when `kind === 'sql'`, `kind === 'http'`, or
   * `kind === 'utilities'`.
   */
  workspaceTabId?: string;
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
        const savedTabs: SessionTab[] = tabs.map(tab => ({
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
          //
          // MOV.02/MOV.03 — same treatment for SQL / HTTP / Utilities
          // workspace tabs. The discriminator routes restore through the
          // workspace tab surface, and `workspaceTabId` pins the original id
          // so the stable tab can be re-created without treating it like a
          // disk-backed document.
          kind:
            tab.kind === 'notebook' ||
            tab.kind === 'sql' ||
            tab.kind === 'http' ||
            tab.kind === 'utilities'
              ? tab.kind
              : undefined,
          notebookTabId: tab.kind === 'notebook' ? tab.id : undefined,
          workspaceTabId:
            tab.kind === 'sql' || tab.kind === 'http' || tab.kind === 'utilities'
              ? tab.id
              : undefined,
        }));
        const activeIndex = tabs.findIndex(t => t.id === activeTabId);
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

        // Restore is intentionally a translator, not a blind hydrate. It
        // converts the persisted session shape into the current `FileTab`
        // contract while preserving user intent across older workspace models.
        // SQL/HTTP MODEL rework — collapse legacy per-query/request
        // workspace tabs to a SINGLE stable workspace tab per kind. A
        // pre-rework session could hold N `sql` tabs (one per query) and
        // M `http` tabs; the new model keeps at most one of each. The
        // collection rehydrates from `useWorkspaceSqlStore` /
        // `useWorkspaceToolStore` regardless of how many session entries
        // pointed at it, so we keep the FIRST occurrence of each kind and
        // drop the rest. `savedActiveIndex` is remapped after the loop so
        // the active selection survives the collapse.
        let sqlWorkspaceRestored = false;
        let httpWorkspaceRestored = false;
        let utilitiesWorkspaceRestored = false;

        // Map each surviving saved index to the id it restored to, so we
        // can remap `savedActiveIndex` after collapsing duplicates. A
        // dropped duplicate maps to the stable id its kind collapsed onto
        // (so an active legacy duplicate still focuses the right tab).
        const savedIndexToRestoredId: Array<string | null> = [];

        for (let savedIdx = 0; savedIdx < savedTabs.length; savedIdx += 1) {
          const saved = savedTabs[savedIdx]!;
          let content = saved.content;
          let rootId: RootId | undefined;
          let relativePath: RelativePath | undefined;

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
                // RL-137 — name the denylist refusal so a restored tab whose
                // file now sits in a protected family explains itself.
                if (reopen.error === 'blocked') {
                  void notifyBlockedPath(saved.filePath);
                }
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
          const stdinSupported = isWorkerRunnerLanguage(language);
          const restoredStdinBuffer =
            stdinSupported && typeof saved.stdinBuffer === 'string' ? saved.stdinBuffer : undefined;
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

          // Workspace model rework — restore SQL / HTTP / Utilities tabs to
          // the SINGLE stable workspace id per kind. The collection of
          // queries/requests and active utility selection rehydrate from
          // their own stores, so the session entry only needs to re-create
          // the container tab. A corrupt entry (`kind: 'sql'`/`'http'`/
          // `'utilities'` with no
          // `workspaceTabId`) drops the discriminator and falls back to a
          // plain code tab, matching the prior contract for hand-edited
          // sessions. LEGACY sessions with N per-query tabs collapse:
          // the FIRST `sql` / FIRST `http` entry restores; later
          // duplicates are skipped (but still remap their active index
          // onto the surviving stable tab).
          const isSqlWorkspaceEntry =
            saved.kind === 'sql' &&
            typeof saved.workspaceTabId === 'string' &&
            saved.workspaceTabId.length > 0;
          const isHttpWorkspaceEntry =
            saved.kind === 'http' &&
            typeof saved.workspaceTabId === 'string' &&
            saved.workspaceTabId.length > 0;
          const isUtilitiesWorkspaceEntry =
            saved.kind === 'utilities' &&
            typeof saved.workspaceTabId === 'string' &&
            saved.workspaceTabId.length > 0;

          if (isSqlWorkspaceEntry) {
            // Collapse: a SQL workspace tab already restored → skip this
            // duplicate but point its active index at the surviving tab.
            if (sqlWorkspaceRestored) {
              savedIndexToRestoredId.push(SQL_WORKSPACE_TAB_ID);
              continue;
            }
            sqlWorkspaceRestored = true;
            restored.push({
              id: SQL_WORKSPACE_TAB_ID,
              // Stable workspace label — never a single query name.
              name: 'SQL',
              language: 'sql',
              content: '',
              kind: 'sql' as const,
            });
            savedIndexToRestoredId.push(SQL_WORKSPACE_TAB_ID);
            continue;
          }

          if (isHttpWorkspaceEntry) {
            if (httpWorkspaceRestored) {
              savedIndexToRestoredId.push(HTTP_WORKSPACE_TAB_ID);
              continue;
            }
            httpWorkspaceRestored = true;
            restored.push({
              id: HTTP_WORKSPACE_TAB_ID,
              name: 'HTTP',
              language: 'http',
              content: '',
              kind: 'http' as const,
            });
            savedIndexToRestoredId.push(HTTP_WORKSPACE_TAB_ID);
            continue;
          }

          if (isUtilitiesWorkspaceEntry) {
            if (utilitiesWorkspaceRestored) {
              savedIndexToRestoredId.push(UTILITIES_WORKSPACE_TAB_ID);
              continue;
            }
            utilitiesWorkspaceRestored = true;
            restored.push({
              id: UTILITIES_WORKSPACE_TAB_ID,
              name: 'Utilities',
              language: 'utilities',
              content: '',
              kind: 'utilities' as const,
            });
            savedIndexToRestoredId.push(UTILITIES_WORKSPACE_TAB_ID);
            continue;
          }

          const restoredId = restoredAsNotebook ? saved.notebookTabId! : crypto.randomUUID();

          restored.push({
            id: restoredId,
            name: saved.name,
            language,
            content,
            filePath: saved.filePath,
            rootId,
            relativePath,
            ...(restoredRuntimeMode !== null ? { runtimeMode: restoredRuntimeMode } : {}),
            ...(restoredStdinBuffer !== undefined ? { stdinBuffer: restoredStdinBuffer } : {}),
            ...(restoredRecipeBindingId !== undefined
              ? { recipeBindingId: restoredRecipeBindingId }
              : {}),
            ...(restoredAsNotebook ? { kind: 'notebook' as const } : {}),
          });
          savedIndexToRestoredId.push(restoredId);
        }

        // Bypass the RL-060 tier ceiling — restoring a prior session must
        // grandfather the user's workspace, not truncate it. Resolve the
        // active id through the saved-index → restored-id remap so a
        // collapsed legacy workspace duplicate still focuses the right
        // surviving tab. A dropped (non-workspace) entry maps to null,
        // so we fall back to no active tab in that edge case.
        const activeId =
          savedActiveIndex >= 0 && savedActiveIndex < savedIndexToRestoredId.length
            ? (savedIndexToRestoredId[savedActiveIndex] ?? null)
            : null;
        useEditorStore.getState().restoreTabs(restored, activeId);
        const recipeStore = useRecipeStore.getState();
        for (const tab of restored) {
          if (tab.recipeBindingId !== undefined) {
            recipeStore.bindRecipeToTab(tab.id, tab.recipeBindingId);
          }
        }
        const activeRestoredTab = restored.find(tab => tab.id === activeId);
        if (activeRestoredTab?.recipeBindingId !== undefined) {
          useUIStore.getState().openBottomPanel('recipe');
        }
      },
    }),
    {
      name: 'lingua-session',
      version: 1,
      migrate: createMigrate('lingua-session'),
      // Only the serializable snapshot belongs in localStorage. Actions and
      // live editor/UI state are rebuilt from the store creators at runtime.
      partialize: state => ({
        savedTabs: state.savedTabs,
        savedActiveIndex: state.savedActiveIndex,
      }),
    }
  )
);

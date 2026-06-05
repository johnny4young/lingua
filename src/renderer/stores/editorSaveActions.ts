import type { EditorState, FileTab } from '../types';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { joinAbsolute } from '../utils/filePath';
import { useProjectStore } from './projectStore';
import { useRecentFilesStore } from './recentFilesStore';
import { useDependencyDetectionStore } from './dependencyDetectionStore';
import { useRecipeStore } from './recipeStore';
import { useResultStore } from './resultStore';
import { useUIStore } from './uiStore';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { withinTabBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';
import i18next from 'i18next';
import type { EditorGet, EditorSet } from './editorStoreContext';
import { runtimeModeForNewTab, workflowModeForNewTab } from './editorModeHelpers';
import { budgetedTabCount } from './editorTabUtils';
import { persistTab } from './editorPersistence';

/**
 * RL-128 fold A/B — file-open + save action factory for the editor store.
 *
 * Bundles `openFile` / `openFileFromDisk` (capability-backed disk opens with
 * the Free tab-budget gate) and the Save family (`saveActiveTab`,
 * `saveActiveTabAs`, `saveTabById` — the latter routing through `persistTab`
 * with the snapshot-ring / dependency-cache / recipe-unbind / rootId-revoke
 * cascade). The close + rename actions live in `editorCloseActions`. Extracted
 * verbatim from `editorStore.ts`; the async actions re-read `get()` after each
 * `await`, so the mid-save tab-switch guards behave identically to the
 * pre-split inline definitions.
 */
export function createSaveActions(
  set: EditorSet,
  get: EditorGet
): Pick<
  EditorState,
  'openFile' | 'openFileFromDisk' | 'saveActiveTab' | 'saveActiveTabAs' | 'saveTabById'
> {
  return {
    openFile: async (rootId, relativePath, name, language, displayPath) => {
      const { tabs } = get();

      const existing = tabs.find(
        (t) => t.rootId === rootId && t.relativePath === relativePath
      );
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }

      if (!withinTabBudget(currentEffectiveTier(), budgetedTabCount(tabs) + 1)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraTabs'),
        });
        // RL-065 — same emit on the openFile gate so both rejection
        // paths surface a feature.blocked event.
        void trackEvent('feature.blocked', {
          entitlement: 'tabs',
          tier: currentEffectiveTier(),
        });
        return;
      }

      const content = await window.lingua.fs.read(rootId, relativePath);
      const filePath = displayPath ?? relativePath;

      const newTab: FileTab = {
        id: crypto.randomUUID(),
        name,
        language,
        content,
        isDirty: false,
        rootId,
        relativePath,
        filePath,
        // RL-019 Slice 1 — disk-backed JS/TS opens adopt the per-app
        // default runtime mode; non-JS/TS files leave the field unset.
        runtimeMode: runtimeModeForNewTab(language),
        // RL-020 Slice 2 — disk-backed opens also adopt the per-app
        // default workflow mode so the toolbar segment has a value to
        // reflect on first render.
        workflowMode: workflowModeForNewTab(language),
      };

      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));

      useRecentFilesStore.getState().addRecentFile({ filePath, name, language });
    },

    openFileFromDisk: async () => {
      const result = await window.lingua.fs.selectFile();
      if (result.canceled) return;
      const language = resolveFileLanguageOrPlaintext(result.fileName);
      const { tabs } = get();
      const filePath = joinAbsolute(result.rootPath, result.fileRelativePath);

      const existing = tabs.find(
        (t) =>
          (t.rootId === result.rootId && t.relativePath === result.fileRelativePath) ||
          t.filePath === filePath
      );
      if (existing) {
        await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
        set({ activeTabId: existing.id });
        return;
      }

      if (!withinTabBudget(currentEffectiveTier(), budgetedTabCount(tabs) + 1)) {
        await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraTabs'),
        });
        void trackEvent('feature.blocked', {
          entitlement: 'tabs',
          tier: currentEffectiveTier(),
        });
        return;
      }

      const newTab: FileTab = {
        id: crypto.randomUUID(),
        name: result.fileName,
        language,
        content: result.content,
        isDirty: false,
        rootId: result.rootId,
        relativePath: result.fileRelativePath,
        filePath,
        // RL-019 Slice 1 — same JS/TS default mode as openFile().
        runtimeMode: runtimeModeForNewTab(language),
        // RL-020 Slice 2 — same per-language workflow-mode default.
        workflowMode: workflowModeForNewTab(language),
      };

      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));

      useRecentFilesStore
        .getState()
        .addRecentFile({ filePath, name: result.fileName, language });
    },

    saveActiveTab: async () => {
      const { activeTabId, saveTabById } = get();
      if (!activeTabId) return;
      await saveTabById(activeTabId);
    },

    saveActiveTabAs: async () => {
      const { activeTabId, saveTabById } = get();
      if (!activeTabId) return;
      await saveTabById(activeTabId, true);
    },

    saveTabById: async (id, forceSaveAs = false) => {
      const { tabs } = get();
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return false;
      // MOV.02 — SQL / HTTP workspace tabs have no disk representation;
      // their query/request is auto-persisted to the workspace store on
      // every edit. A Save / Save-As gesture (Cmd+S, palette) would
      // otherwise open a file dialog and write the empty `content` to
      // disk. There is nothing pending here (unlike notebooks), so we
      // no-op silently rather than surfacing a notice.
      if (tab.kind === 'sql' || tab.kind === 'http') {
        return false;
      }
      if (tab.kind === 'notebook') {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'notebook.notice.diskPersistencePending',
        });
        return false;
      }

      const previousPath = tab.filePath;
      const previousRootId = tab.rootId;
      const previousLanguage = tab.language;
      const savedTab = await persistTab(tab, forceSaveAs);
      if (!savedTab) return false;

      set((state) => ({
        tabs: state.tabs.map((t) => (t.id === id ? savedTab : t)),
      }));

      // RL-020 Slice 8 — Save-As that changed the language invalidates
      // the result-store snapshot ring for the saved tab. Re-read
      // `activeTabId` at this point (not the value captured before the
      // async `persistTab` hop) so that if the user switched tabs
      // mid-save we do NOT drop the new active tab's snapshot ring.
      // `useAutoRun` already clears the ring on tab switch; if the
      // user navigated away during the file picker, the ring belongs
      // to a different tab and we must leave it alone.
      if (
        savedTab.language !== previousLanguage &&
        get().activeTabId === id
      ) {
        useResultStore.getState().clearLastSuccessfulSnapshot();
      }
      if (savedTab.language !== previousLanguage) {
        useDependencyDetectionStore.getState().evictTab(id);
      }
      if (tab.recipeBindingId !== undefined && savedTab.recipeBindingId === undefined) {
        useRecipeStore.getState().unbindRecipe(id);
      }

      if (previousRootId && previousRootId !== savedTab.rootId) {
        const rootStillUsed = tabs.some(
          (t) => t.id !== id && t.rootId === previousRootId
        );
        const projectRootId = useProjectStore.getState().currentProject?.rootId;
        if (!rootStillUsed && previousRootId !== projectRootId) {
          await window.lingua.fs.revokeRoot(previousRootId).catch(() => {});
        }
      }

      if (forceSaveAs || previousPath !== savedTab.filePath) {
        useRecentFilesStore.getState().addRecentFile({
          filePath: savedTab.filePath,
          name: savedTab.name,
          language: savedTab.language,
        });
      }

      return true;
    },
  };
}

import type { EditorState, FileTab } from '../types/editor';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { joinAbsolute } from '../utils/filePath';
import { useRecentFilesStore } from './recentFilesStore';
import { currentEffectiveTier } from './licenseSelectors';
import { isEntitled, withinTabBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';
import i18next from 'i18next';
import type { EditorGet, EditorSet } from './editorStoreContext';
import { runtimeModeForNewTab, workflowModeForNewTab } from './editorModeHelpers';
import { budgetedTabCount } from './editorTabUtils';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import { notifyBlockedFamily } from '../utils/blockedPath';

/** Capability-backed file opens load only on explicit user or navigation gestures. */
export function createDocumentOpenActions(
  set: EditorSet,
  get: EditorGet
): Pick<EditorState, 'openFile' | 'openFileFromDisk'> {
  return {
    openFile: async (rootId, relativePath, name, language, displayPath, stillCurrent) => {
      if (stillCurrent && !stillCurrent()) return;
      const { tabs } = get();

      const existing = tabs.find(t => t.rootId === rootId && t.relativePath === relativePath);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }

      if (!withinTabBudget(currentEffectiveTier(), budgetedTabCount(tabs) + 1)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraTabs'),
        });
        // internal — same emit on the openFile gate so both rejection
        // paths surface a feature.blocked event.
        void trackEvent('feature.blocked', {
          entitlement: 'tabs',
          tier: currentEffectiveTier(),
        });
        return;
      }

      const isNotebook = name.toLowerCase().endsWith('.linguanb');
      if (isNotebook && !isEntitled(currentEffectiveTier(), 'NOTEBOOK_MODE')) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.notebookMode'),
        });
        return;
      }
      const content = await window.lingua.fs.read(asRootId(rootId), asRelativePath(relativePath));
      if (stillCurrent && !stillCurrent()) return;
      const documents = isNotebook ? await import('./notebookDocumentOpen') : null;
      const prepared = documents ? await documents.prepareNotebookDocument(content) : null;
      if (stillCurrent && !stillCurrent()) return;
      if (isNotebook && !prepared) return;
      const filePath = displayPath ?? relativePath;

      // Re-check the dedup + budget AFTER the disk read: a double-click on
      // the file tree fires two openFile calls that both pass the checks
      // above while neither tab exists yet, opening the same file twice
      // (and double-charging the Free tab budget).
      const tabsAfterRead = get().tabs;
      if (isNotebook && !isEntitled(currentEffectiveTier(), 'NOTEBOOK_MODE')) return;
      const existingAfterRead = tabsAfterRead.find(
        t => t.rootId === rootId && t.relativePath === relativePath
      );
      if (existingAfterRead) {
        set({ activeTabId: existingAfterRead.id });
        return;
      }
      if (!withinTabBudget(currentEffectiveTier(), budgetedTabCount(tabsAfterRead) + 1)) {
        return;
      }

      const newTab: FileTab = {
        id: crypto.randomUUID(),
        name,
        language,
        content: prepared?.content ?? content,
        ...(prepared ? documents!.notebookTabMetadata(prepared) : {}),
        isDirty: false,
        rootId,
        relativePath,
        filePath,
        // implementation — disk-backed JS/TS opens adopt the per-app
        // default runtime mode; non-JS/TS files leave the field unset.
        runtimeMode: runtimeModeForNewTab(language),
        // implementation — disk-backed opens also adopt the per-app
        // default workflow mode so the toolbar segment has a value to
        // reflect on first render.
        workflowMode: workflowModeForNewTab(language),
      };

      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));

      if (prepared) documents!.installPreparedNotebook(newTab.id, prepared);
      useRecentFilesStore.getState().addRecentFile({ filePath, name, language });
    },

    openFileFromDisk: async () => {
      const result = await window.lingua.fs.selectFile();
      if (result.canceled) {
        notifyBlockedFamily(result.blockedFamily);
        return;
      }
      const isNotebook = result.fileName.toLowerCase().endsWith('.linguanb');
      const documents = isNotebook ? await import('./notebookDocumentOpen') : null;
      const prepared = documents ? await documents.prepareNotebookDocument(result.content) : null;
      if (isNotebook && (!prepared || !isEntitled(currentEffectiveTier(), 'NOTEBOOK_MODE'))) {
        await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
        if (prepared)
          pushUpsellNotice({
            messageKey: 'upsell.freeCeilingReached',
            featureLabel: i18next.t('upsell.feature.notebookMode'),
          });
        return;
      }
      const language = resolveFileLanguageOrPlaintext(result.fileName);
      const { tabs } = get();
      const filePath = joinAbsolute(result.rootPath, result.fileRelativePath);

      const existing = tabs.find(
        t =>
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
        content: prepared?.content ?? result.content,
        ...(prepared ? documents!.notebookTabMetadata(prepared) : {}),
        isDirty: false,
        rootId: result.rootId,
        relativePath: result.fileRelativePath,
        filePath,
        // implementation — same JS/TS default mode as openFile().
        runtimeMode: runtimeModeForNewTab(language),
        // implementation — same per-language workflow-mode default.
        workflowMode: workflowModeForNewTab(language),
      };

      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));

      if (prepared) documents!.installPreparedNotebook(newTab.id, prepared);
      useRecentFilesStore.getState().addRecentFile({ filePath, name: result.fileName, language });
    },
  };
}

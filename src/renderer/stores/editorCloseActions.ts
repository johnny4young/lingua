import type { EditorState, Language } from '../types';
import { getActiveAppLanguage } from '../i18n';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { useResultStore } from './resultStore';
import { useDependencyDetectionStore } from './dependencyDetectionStore';
import { useRecipeStore } from './recipeStore';
import { useNotebookStore } from './notebookStore';
import { trackEvent } from '../utils/telemetry';
import { defaultWorkflowMode, type WorkflowMode } from '../../shared/workflowMode';
import type { EditorGet, EditorSet } from './editorStoreContext';
import { runtimeModeForRestoredTab, workflowModeForRestoredTab } from './editorModeHelpers';
import {
  dropAutoLogIfUnsupported,
  dropCompareIfLanguageChanged,
  dropNextRunTimeoutOverride,
  dropRecipeBindingIfLanguageChanged,
  dropStdinIfUnsupported,
  dropVariableInspectorIfLanguageChanged,
  isWorkspaceTab,
  languageSupportsAutoLog,
  normalizeNotebookTitle,
  notebookFileNameForTitle,
} from './editorTabUtils';

/**
 * RL-128 fold A/B — close + rename action factory for the editor store.
 *
 * Bundles `closeTab` (dirty-confirm dialog, then `removeTab`) and its bulk
 * variants (`closeOtherTabs`, `closeTabsToRight`, `closeAllTabs` — each
 * funnelling through `closeTab` so the unsaved-work prompt always fires) plus
 * the language-aware `renameTab` (notebook-title path + the JS-vs-other-language
 * capability-drop ladder + the snapshot-ring / dependency-cache / recipe-unbind
 * / workflow-correction-telemetry cascade). Extracted verbatim from
 * `editorStore.ts`; the bulk closers read `get().closeTab` and `closeTab` reads
 * `get().removeTab`/`get().saveTabById`, resolving against the fully-assembled
 * store so cross-factory wiring is identical to the pre-split definitions.
 */
export function createCloseActions(
  set: EditorSet,
  get: EditorGet
): Pick<
  EditorState,
  'closeTab' | 'renameTab' | 'closeOtherTabs' | 'closeTabsToRight' | 'closeAllTabs'
> {
  return {
    closeTab: async id => {
      const { tabs, removeTab, saveTabById } = get();
      const tab = tabs.find(t => t.id === id);
      if (!tab) return true;

      if (!tab.isDirty) {
        removeTab(id);
        return true;
      }

      // Show confirmation dialog
      const response = await window.lingua.confirmCloseTab(tab.name, getActiveAppLanguage());
      if (response === 0) {
        const saved = await saveTabById(id);
        if (!saved) return false;
        removeTab(id);
        return true;
      } else if (response === 1) {
        // Discard
        removeTab(id);
        return true;
      }
      // Cancel
      return false;
    },

    /**
     * Rename a tab in place. The new name flows through
     * `resolveFileLanguageOrPlaintext` so a `.py` → `.go` rename also
     * flips the Monaco language. The tab is marked dirty because the
     * on-disk filename diverges from the in-memory one until the next
     * save reuses Save As.
     *
     * No-ops when the tab does not exist or the trimmed name is empty,
     * so accidental Enter on an empty rename input does not silently
     * destroy the filename.
     */
    renameTab: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existingTab = get().tabs.find(tab => tab.id === id);
      // SQL/HTTP MODEL rework — a SQL / HTTP / Utilities workspace tab always shows the
      // fixed "SQL" / "HTTP" workspace label + kind glyph, never a query /
      // request name (those are renamed in the rail). Refuse a tab rename
      // so an inline F2 / double-click can't drift the workspace label.
      if (existingTab && isWorkspaceTab(existingTab)) return;
      if (existingTab?.kind === 'notebook') {
        const title = normalizeNotebookTitle(trimmed);
        const name = notebookFileNameForTitle(title);
        set(state => ({
          tabs: state.tabs.map(tab => {
            if (tab.id !== id) return tab;
            if (tab.name === name) return tab;
            return {
              ...tab,
              name,
              language: tab.language,
              isDirty: false,
            };
          }),
        }));
        useNotebookStore.getState().renameNotebookForTab(id, title);
        return;
      }
      // RL-020 Slice 2 fold D — when a rename auto-corrects the
      // workflow mode (e.g. JS Debug → Rust forces Run because Rust
      // has no debugger adapter), emit telemetry with
      // `trigger: 'language_change'` so the audit trail covers the
      // implicit transition, not just toolbar gestures.
      const correctionsToEmit: Array<{
        language: Language;
        from: WorkflowMode;
        to: WorkflowMode;
      }> = [];
      // RL-020 Slice 8 — track whether the rename flipped the active
      // tab's language so we can drop the result-store comparator
      // snapshot below.
      let activeTabLanguageChanged = false;
      let tabLanguageChanged = false;
      set(state => {
        const next = state.tabs.map(tab => {
          if (tab.id !== id) return tab;
          if (tab.name === trimmed) return tab;
          const language = resolveFileLanguageOrPlaintext(trimmed);
          const previousLanguage = tab.language;
          const runtimeMode = runtimeModeForRestoredTab(language, tab.runtimeMode);
          const previousWorkflow = tab.workflowMode ?? defaultWorkflowMode(tab.language);
          const workflowMode = workflowModeForRestoredTab(language, tab.workflowMode);
          if (previousWorkflow !== workflowMode) {
            correctionsToEmit.push({
              language,
              from: previousWorkflow,
              to: workflowMode,
            });
          }
          if (previousLanguage !== language && state.activeTabId === tab.id) {
            activeTabLanguageChanged = true;
          }
          if (previousLanguage !== language) {
            tabLanguageChanged = true;
          }
          // RL-020 Slice 5 fold C — when the new language is not
          // JS / TS, clear any persisted per-tab auto-log override so a
          // stale flag from before the rename does not influence the
          // resolved gate. The per-language Settings default is the
          // only owner of the value for the new language.
          const renamed = {
            ...tab,
            name: trimmed,
            language,
            runtimeMode,
            workflowMode,
            isDirty: true,
          };
          if (languageSupportsAutoLog(language)) {
            // RL-020 Slice 7 — the per-tab one-shot extended timeout
            // override is always scoped to the code the user was
            // looking at when they armed it. A rename to ANY new
            // language clears the override, even if the new language
            // still supports auto-log. The user can re-arm via the
            // palette if they want to.
            return dropRecipeBindingIfLanguageChanged(
              dropVariableInspectorIfLanguageChanged(
                dropCompareIfLanguageChanged(
                  dropNextRunTimeoutOverride({
                    ...renamed,
                    autoLogEnabled: tab.autoLogEnabled,
                  }),
                  previousLanguage
                ),
                previousLanguage
              ),
              previousLanguage
            );
          }
          return dropRecipeBindingIfLanguageChanged(
            dropVariableInspectorIfLanguageChanged(
              dropCompareIfLanguageChanged(
                dropNextRunTimeoutOverride(
                  dropStdinIfUnsupported(dropAutoLogIfUnsupported(renamed))
                ),
                previousLanguage
              ),
              previousLanguage
            ),
            previousLanguage
          );
        });
        return { tabs: next };
      });
      // RL-020 Slice 8 — same-tab language change invalidates the
      // result-store snapshot ring (it was captured for the previous
      // language and would surface as a stale comparator). Tab
      // switches handle their own cascade via `clear()`.
      if (activeTabLanguageChanged) {
        useResultStore.getState().clearLastSuccessfulSnapshot();
      }
      if (tabLanguageChanged) {
        useDependencyDetectionStore.getState().evictTab(id);
      }
      if (tabLanguageChanged) {
        const renamedTab = get().tabs.find(tab => tab.id === id);
        if (renamedTab?.recipeBindingId === undefined) {
          useRecipeStore.getState().unbindRecipe(id);
        }
      }
      for (const correction of correctionsToEmit) {
        void trackEvent('runtime.workflow_mode_changed', {
          language: correction.language,
          from: correction.from,
          to: correction.to,
          trigger: 'language_change',
        });
      }
    },

    /**
     * Close every tab whose id is NOT the supplied one. Each dirty tab
     * still funnels through `closeTab` so the existing
     * `confirmCloseTab` prompt is honored — the user cannot lose
     * unsaved work via this bulk action even when triggered by a
     * single context-menu click.
     */
    closeOtherTabs: async id => {
      const { tabs, closeTab } = get();
      const targets = tabs.filter(tab => tab.id !== id).map(tab => tab.id);
      for (const tabId of targets) {
        const closed = await closeTab(tabId);
        if (!closed) break;
      }
    },

    /**
     * Close every tab to the right of the supplied id, preserving the
     * pivot. Same dirty-check contract as `closeOtherTabs`.
     */
    closeTabsToRight: async id => {
      const { tabs, closeTab } = get();
      const pivot = tabs.findIndex(tab => tab.id === id);
      if (pivot < 0) return;
      const targets = tabs.slice(pivot + 1).map(tab => tab.id);
      for (const tabId of targets) {
        const closed = await closeTab(tabId);
        if (!closed) break;
      }
    },

    /**
     * Close every open tab. Goes through `closeTab` per-tab so dirty
     * prompts still fire — the user can cancel mid-batch.
     */
    closeAllTabs: async () => {
      const { tabs, closeTab } = get();
      const targets = tabs.map(tab => tab.id);
      for (const tabId of targets) {
        const closed = await closeTab(tabId);
        if (!closed) break;
      }
    },
  };
}

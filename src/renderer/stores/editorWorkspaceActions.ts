import type { EditorState, FileTab } from '../types';
import i18next from 'i18next';
import { useNotebookStore } from './notebookStore';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isEntitled, isLanguageAllowed, withinTabBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import type { EditorGet, EditorSet } from './editorStoreContext';
import {
  budgetedTabCount,
  HTTP_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_NAME,
  SQL_WORKSPACE_TAB_ID,
  SQL_WORKSPACE_TAB_NAME,
} from './editorTabUtils';

/**
 * RL-128 fold A/B — workspace-opener action factory for the editor store.
 *
 * Bundles `addNotebookTab` (entitlement-gated notebook tab + companion
 * notebookStore seed) and the SQL / HTTP focus-or-create openers, which mint at
 * most one workspace tab per kind under a stable id and are exempt from the
 * Free tab budget. Extracted verbatim from `editorStore.ts`;
 * `createWorkspaceActions(set, get)` receives the same zustand `set`/`get` the
 * inline `create()` callback received.
 */
export function createWorkspaceActions(
  set: EditorSet,
  get: EditorGet
): Pick<EditorState, 'addNotebookTab' | 'addSqlTab' | 'addHttpTab'> {
  return {
    /**
     * RL-043 Slice A — Create a fresh notebook tab. Wraps `addTab` with
     * `kind: 'notebook'` + a `.linguanb` extension on the tab name so
     * the existing language-detection in `addTab` doesn't try to set a
     * single-language `language` for the new tab. Seeds the companion
     * notebookStore entry so the panel mounts with a runnable starter.
     */
    addNotebookTab: (opts) => {
      const { tabs } = get();
      const tier = currentEffectiveTier();
      if (!isEntitled(tier, 'NOTEBOOK_MODE')) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.notebookMode'),
        });
        return null;
      }
      const requestedLanguage = opts?.language ?? 'javascript';
      if (!isLanguageAllowed(tier, requestedLanguage)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraLanguages'),
        });
        return null;
      }
      if (!withinTabBudget(tier, budgetedTabCount(tabs) + 1)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraTabs'),
        });
        return null;
      }
      const tabId = crypto.randomUUID();
      const title = (opts?.title ?? 'Untitled notebook').trim() || 'Untitled notebook';
      const newTab: FileTab = {
        id: tabId,
        name: title.endsWith('.linguanb') ? title : `${title}.linguanb`,
        language: requestedLanguage,
        content: '',
        isDirty: false,
        kind: 'notebook',
      };
      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: tabId,
      }));
      useNotebookStore.getState().createNotebookForTab(tabId, title);
      return tabId;
    },

    /**
     * SQL/HTTP MODEL rework — focus (or create) the SINGLE SQL workspace
     * tab. The SQL surface is a TablePlus-style COLLECTION workspace, not
     * one editor tab per query, so there is at most ONE SQL tab carrying
     * the stable `SQL_WORKSPACE_TAB_ID`. The collection of queries lives
     * in `useWorkspaceSqlStore.queries` and is navigated by the in-panel
     * rail (`activeQueryId`); the tab does NOT seed or map to a single
     * query.
     *
     * This path deliberately bypasses `addTab` because `addTab` runs
     * `isLanguageAllowed` against `'sql'` (not in the Free language
     * allowlist) and would wrongly upsell-block the workspace. Workspace
     * tabs are exempt from the RL-060 tab budget (see `budgetedTabCount`),
     * so a Free user always gets the SQL workspace.
     *
     * `opts` is accepted for signature compatibility with legacy callers
     * but ignored — there is only one SQL tab to focus-or-create, and the
     * query name lives on the `SqlQueryV1`, not the tab. Returns the
     * stable workspace tab id.
     */
    addSqlTab: () => {
      const { tabs } = get();
      const existing = tabs.find((t) => t.id === SQL_WORKSPACE_TAB_ID);
      if (existing) {
        set({ activeTabId: existing.id });
        return existing.id;
      }
      const newTab: FileTab = {
        id: SQL_WORKSPACE_TAB_ID,
        name: SQL_WORKSPACE_TAB_NAME,
        // Neutral marker language — not Monaco-runnable. Keeps every
        // language-gated guard (runtime mode, workflow mode, auto-log,
        // stdin, recipe, variable inspector) dormant for this tab.
        language: 'sql',
        content: '',
        isDirty: false,
        kind: 'sql',
      };
      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));
      // No companion query is seeded here — the rail owns query
      // creation. The workspace store rehydrates its own collection
      // across reloads, independent of this tab.
      return newTab.id;
    },

    /**
     * SQL/HTTP MODEL rework — focus (or create) the SINGLE HTTP workspace
     * tab. Mirror of `addSqlTab`: an Insomnia/Postman-style COLLECTION
     * workspace, not one editor tab per request. The collection lives in
     * `useWorkspaceToolStore.requests`, navigated by the in-panel rail
     * (`activeRequestId`). Carries the stable `HTTP_WORKSPACE_TAB_ID`,
     * exempt from the tab budget, and seeds no request. Returns the
     * stable workspace tab id.
     */
    addHttpTab: () => {
      const { tabs } = get();
      const existing = tabs.find((t) => t.id === HTTP_WORKSPACE_TAB_ID);
      if (existing) {
        set({ activeTabId: existing.id });
        return existing.id;
      }
      const newTab: FileTab = {
        id: HTTP_WORKSPACE_TAB_ID,
        name: HTTP_WORKSPACE_TAB_NAME,
        language: 'http',
        content: '',
        isDirty: false,
        kind: 'http',
      };
      set((state) => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));
      return newTab.id;
    },
  };
}

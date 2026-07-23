import type { EditorState } from '../types';
import i18next from 'i18next';
import { useProjectStore } from './projectStore';
import { useDependencyDetectionStore } from './dependencyDetectionStore';
import { useRecipeStore } from './recipeStore';
import { useNotebookStore } from './notebookStore';
import { currentEffectiveTier } from './licenseSelectors';
import { isLanguageAllowed, withinTabBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';
import type { EditorGet, EditorSet } from './editorStoreContext';
import {
  runtimeModeForNewTab,
  runtimeModeForRestoredTab,
  workflowModeForNewTab,
  workflowModeForRestoredTab,
} from './editorModeHelpers';
import {
  budgetedTabCount,
  dropAutoLogIfUnsupported,
  dropStdinIfUnsupported,
  isWorkspaceTab,
} from './editorTabUtils';
import { getActiveTab } from './editorSelectors';
import { asRootId } from '../../shared/fs/brandedIds';

/**
 * implementation — tab-lifecycle action factory for the editor store.
 *
 * Bundles the create / restore / remove / focus / duplicate actions plus the
 * reveal plumbing, `setTabLanguage`, and `markSaved`. The SQL / HTTP / Utilities / notebook
 * workspace openers live in `editorWorkspaceActions`. `createTabActions(set,
 * get)` receives the exact zustand `set`/`get` the `create()` callback would,
 * and returns the matching slice of `EditorState`; cross-factory calls (e.g.
 * `duplicateActiveTab` → `get().addTab`) resolve against the fully-assembled
 * store at call time, so behaviour is identical to the pre-split inline
 * definitions. The lazy `notebookSession` import inside `removeTab` is
 * preserved so the static module graph still does not pull `runnerManager`
 * (and its `esbuild-wasm` import) into every editor-store consumer.
 */
export function createTabActions(
  set: EditorSet,
  get: EditorGet
): Pick<
  EditorState,
  | 'requestReveal'
  | 'clearPendingReveal'
  | 'addTab'
  | 'restoreTabs'
  | 'removeTab'
  | 'setActiveTab'
  | 'setTabLanguage'
  | 'duplicateActiveTab'
  | 'markSaved'
> {
  return {
    requestReveal: target => {
      // `line` must be at least 1 — Monaco rejects 0-indexed positions. We clamp
      // defensively so upstream surfaces (Project Search, Go to Symbol) can stay
      // agnostic about Monaco's 1-indexed contract.
      if (!target.filePath && !target.tabId) {
        throw new Error('requestReveal requires either filePath or tabId');
      }
      const safeLine = Math.max(1, Math.floor(target.line));
      const safeColumn =
        target.column === undefined ? undefined : Math.max(1, Math.floor(target.column));
      set({
        pendingReveal: {
          filePath: target.filePath,
          tabId: target.tabId,
          line: safeLine,
          column: safeColumn,
        },
      });
    },

    clearPendingReveal: () => set({ pendingReveal: null }),

    addTab: tab => {
      const { tabs } = get();
      if (!isLanguageAllowed(currentEffectiveTier(), tab.language)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraLanguages'),
        });
        void trackEvent('feature.blocked', {
          entitlement: 'languages-extended',
          tier: currentEffectiveTier(),
        });
        return;
      }
      // internal: block new-tab creation once the Free ceiling is hit. Users
      // already over the ceiling (grandfathered data from before gating
      // shipped) keep their tabs; only additions past the ceiling are
      // refused so nobody loses work in the upgrade. Workspace tabs
      // (SQL / HTTP / Utilities) are exempt — they never reach this
      // `addTab` path, and `budgetedTabCount` excludes any that exist so they don't
      // crowd out the Free user's three code tabs.
      if (!withinTabBudget(currentEffectiveTier(), budgetedTabCount(tabs) + 1)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraTabs'),
        });
        // internal — emit feature.blocked so the consenting user's
        // telemetry reflects the friction. Allowlist already permits
        // this event with `entitlement` + `tier`.
        void trackEvent('feature.blocked', {
          entitlement: 'tabs',
          tier: currentEffectiveTier(),
        });
        return;
      }
      // implementation — defensively assign a runtime mode if the
      // caller forgot. Most call sites go through `createDefaultTab`
      // which already sets it, but `addTab({ ...tab, content })`
      // callers might rebuild the object and lose the field.
      const runtimeMode = runtimeModeForNewTab(tab.language, tab.runtimeMode);
      // implementation — same defensive backfill for the workflow
      // mode. `duplicateActiveTab` for example forwards a tab through
      // `addTab` without going through `createDefaultTab`.
      const workflowMode = workflowModeForNewTab(tab.language, tab.workflowMode);
      const newTab = dropStdinIfUnsupported(
        dropAutoLogIfUnsupported({
          ...tab,
          isDirty: false,
          runtimeMode,
          workflowMode,
        })
      );
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }));
    },

    restoreTabs: (tabs, activeTabId) =>
      set({
        tabs: tabs.map(tab =>
          dropStdinIfUnsupported(
            dropAutoLogIfUnsupported({
              ...tab,
              isDirty: false,
              // implementation — backfill missing runtime modes for JS/TS
              // tabs restored from a legacy session. Non-JS/TS tabs
              // never carry the field.
              runtimeMode: runtimeModeForRestoredTab(tab.language, tab.runtimeMode),
              // implementation — backfill missing workflow modes for tabs
              // restored from a legacy session. Every tab carries
              // the field in implementation onwards; the coerce helper snaps a
              // tampered persisted value back to the language default.
              workflowMode: workflowModeForRestoredTab(tab.language, tab.workflowMode),
            })
          )
        ),
        activeTabId: activeTabId ?? null,
      }),

    removeTab: id =>
      set(state => {
        const target = state.tabs.find(t => t.id === id);
        const tabs = state.tabs.filter(t => t.id !== id);
        const activeTabId =
          state.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
        // internal — revoke a tab-private capability when the last tab
        // using it goes away. Project-tree opens share the active
        // project's `rootId` (revoked centrally by `closeProject`), so
        // we leave that one alone; single-file picker / deep-link /
        // session-restore mints are unique per tab and would otherwise
        // accumulate in main's registry until app shutdown.
        if (target?.rootId) {
          const stillUsed = tabs.some(t => t.rootId === target.rootId);
          const projectRootId = useProjectStore.getState().currentProject?.rootId;
          if (!stillUsed && target.rootId !== projectRootId) {
            void window.lingua.fs.revokeRoot(asRootId(target.rootId)).catch(() => {});
          }
        }
        // implementation — evict the per-tab detection cache so the
        // dependency panel cannot surface stale rows for a closed
        // tab id that is later reused by a fresh `addTab()`.
        useDependencyDetectionStore.getState().evictTab(id);
        // implementation Slice B implementation note — unbind any recipe + drop in-flight
        // run-result entries so the bottom-panel 'recipe' tab cannot
        // resurface for a recycled tab id, and so `passedCount()` on
        // the FloatingActionPill badge stays accurate. Mirrors the
        // dependency-cache eviction above; the recipeStore is
        // non-persisted but the entries would otherwise leak per
        // tab close until full page reload.
        useRecipeStore.getState().unbindRecipe(id);
        // implementation — dispose the notebook session + drop the
        // companion notebookStore entry so a recycled tab id can't
        // resurface the previous notebook. The session is per-tab
        // sandbox state held in memory; the notebookStore is persisted
        // but keyed by tabId, so an orphan entry would survive across
        // reloads without this hook.
        // Lazy import — see header comment. Scratchpad/workspace tabs never
        // own notebook runner state, so do not load the full runner graph just
        // to close them. Keep import failures contained during app shutdown.
        if (target?.kind === 'notebook') {
          void import('../runtime/notebookSession')
            .then(mod => mod.disposeNotebookSession(id))
            .catch(() => {});
        }
        useNotebookStore.getState().disposeNotebookForTab(id);
        // SQL/HTTP MODEL rework — closing a SQL / HTTP / Utilities workspace tab does
        // NOT delete the collection. The queries/requests live in
        // `useWorkspaceSqlStore` / `useWorkspaceToolStore`, persisted on
        // their own localStorage keys; reopening the workspace (Mod+Alt+S
        // / Mod+Shift+K / palette) re-creates the single stable tab and
        // the rail rehydrates every saved query/request. Only the tab is
        // dropped here. (Individual query/request deletion is the rail's
        // job via `deleteQuery` / `deleteRequest`, not tab close.)
        return { tabs, activeTabId };
      }),

    setActiveTab: id => set({ activeTabId: id }),

    /**
     * implementation note — switch a tab's language without
     * re-creating it. Used by the `.ipynb` import flow to flip a
     * freshly-imported notebook tab's language chip to the dominant
     * cell language (e.g. Python) so the FloatingActionPill displays
     * the right badge after import.
     *
     * No-op when the tab doesn't exist, when the language matches,
     * or when the user is on a tier that doesn't allow the new
     * language. Tab content is preserved.
     */
    setTabLanguage: (id, language) => {
      const tabs = get().tabs;
      const target = tabs.find(t => t.id === id);
      if (!target) return;
      if (target.language === language) return;
      if (!isLanguageAllowed(currentEffectiveTier(), language)) {
        pushUpsellNotice({
          messageKey: 'upsell.freeCeilingReached',
          featureLabel: i18next.t('upsell.feature.extraLanguages'),
        });
        return;
      }
      set(state => ({
        tabs: state.tabs.map(t => (t.id === id ? { ...t, language } : t)),
      }));
    },

    markSaved: id =>
      set(state => ({
        tabs: state.tabs.map(t => (t.id === id ? { ...t, isDirty: false } : t)),
      })),

    duplicateActiveTab: () => {
      const { addTab } = get();
      const tab = getActiveTab(get());
      if (!tab) return;

      // SQL/HTTP MODEL rework — a SQL / HTTP / Utilities workspace tab is a single
      // collection container, not a document. "Duplicate tab" has no
      // meaning here (there is exactly one workspace tab per kind); the
      // rail owns duplicating an individual query/request inside the
      // collection. Refuse silently rather than mint a second workspace
      // tab with a colliding stable id.
      if (isWorkspaceTab(tab)) {
        return;
      }

      addTab({
        id: crypto.randomUUID(),
        name: `Copy of ${tab.name}`,
        language: tab.language,
        content: tab.content,
      });
    },
  };
}

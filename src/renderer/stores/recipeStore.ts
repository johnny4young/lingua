/**
 * implementation — Recipe overlay + tab-binding store.
 *
 * Owns transient UI state — overlay open flag, per-tab recipe
 * binding, last-run results buffer, per-tab in-flight flag. NOT
 * persisted: a reload should leave the user looking at their tabs
 * with the recipe panel hidden unless the editor tab's
 * `recipeBindingId` survived rehydrate (which it does via
 * `editorStore`'s session restore).
 *
 * Why two stores split (this one + `lessonProgressStore`):
 *
 *   - `recipeStore` is transient — overlay open, last-run results,
 *     in-flight flag. Lives only in memory; dies on reload.
 *   - `lessonProgressStore` is persisted — opened / attempted /
 *     passed status per recipe, sticky across reloads. LRU cap +
 *     sanitize-on-rehydrate.
 *
 * The split keeps the persisted blob small + bounded; transient
 * state never bleeds into the user's lingua-lesson-progress key.
 */

import { create } from 'zustand';
import type { AssertionRunResult } from '../../shared/lessonRunner';

export interface RecipeState {
  /** Open / closed flag for the Recipes overlay. */
  readonly overlayOpen: boolean;
  /**
   * Map<tabId, recipeId> — when a tab is opened from the Recipes
   * overlay, the binding stays alive until the user changes the
   * tab's language to a non-runnable one OR explicitly unbinds.
   * Tab close clears via the editor store hook.
   */
  readonly activeBindingForTab: ReadonlyMap<string, string>;
  /**
   * Last set of assertion results per tab. Cleared whenever the user
   * reruns or the tab loses its binding.
   */
  readonly lastRunResults: ReadonlyMap<string, ReadonlyArray<AssertionRunResult>>;
  /**
   * Per-tab in-flight flag — the Run + Test button mounts this for
   * the active tab while the runner is executing.
   */
  readonly isRunning: ReadonlyMap<string, boolean>;

  // -------- mutations -------------------------------------------------------

  openOverlay: () => void;
  closeOverlay: () => void;
  bindRecipeToTab: (tabId: string, recipeId: string) => void;
  unbindRecipe: (tabId: string) => void;
  setRunResults: (
    tabId: string,
    results: ReadonlyArray<AssertionRunResult>
  ) => void;
  clearRunResults: (tabId: string) => void;
  setRunning: (tabId: string, value: boolean) => void;

  // -------- selectors -------------------------------------------------------

  getBindingForTab: (tabId: string) => string | undefined;
  getRunResultsForTab: (tabId: string) => ReadonlyArray<AssertionRunResult>;
  isTabRunning: (tabId: string) => boolean;
}

function createInitialState(): Pick<
  RecipeState,
  'overlayOpen' | 'activeBindingForTab' | 'lastRunResults' | 'isRunning'
> {
  return {
    overlayOpen: false,
    activeBindingForTab: new Map(),
    lastRunResults: new Map(),
    isRunning: new Map(),
  };
}

export const useRecipeStore = create<RecipeState>()((set, get) => ({
  ...createInitialState(),

  openOverlay: () => set((state) => (state.overlayOpen ? state : { overlayOpen: true })),
  closeOverlay: () => set((state) => (state.overlayOpen ? { overlayOpen: false } : state)),

  bindRecipeToTab: (tabId, recipeId) =>
    set((state) => {
      const existing = state.activeBindingForTab.get(tabId);
      if (existing === recipeId) return state;
      const next = new Map(state.activeBindingForTab);
      next.set(tabId, recipeId);
      // New binding clears any prior run results for this tab so the
      // panel starts in the empty state until the user clicks Run.
      const results = new Map(state.lastRunResults);
      results.delete(tabId);
      return { activeBindingForTab: next, lastRunResults: results };
    }),

  unbindRecipe: (tabId) =>
    set((state) => {
      if (
        !state.activeBindingForTab.has(tabId) &&
        !state.lastRunResults.has(tabId) &&
        !state.isRunning.has(tabId)
      ) {
        return state;
      }
      const bindings = new Map(state.activeBindingForTab);
      bindings.delete(tabId);
      const results = new Map(state.lastRunResults);
      results.delete(tabId);
      const running = new Map(state.isRunning);
      running.delete(tabId);
      return {
        activeBindingForTab: bindings,
        lastRunResults: results,
        isRunning: running,
      };
    }),

  setRunResults: (tabId, results) =>
    set((state) => {
      const next = new Map(state.lastRunResults);
      next.set(tabId, results);
      return { lastRunResults: next };
    }),

  clearRunResults: (tabId) =>
    set((state) => {
      if (!state.lastRunResults.has(tabId)) return state;
      const next = new Map(state.lastRunResults);
      next.delete(tabId);
      return { lastRunResults: next };
    }),

  setRunning: (tabId, value) =>
    set((state) => {
      const current = state.isRunning.get(tabId) ?? false;
      if (current === value) return state;
      const next = new Map(state.isRunning);
      if (value) {
        next.set(tabId, true);
      } else {
        next.delete(tabId);
      }
      return { isRunning: next };
    }),

  getBindingForTab: (tabId) => get().activeBindingForTab.get(tabId),
  getRunResultsForTab: (tabId) => get().lastRunResults.get(tabId) ?? [],
  isTabRunning: (tabId) => get().isRunning.get(tabId) ?? false,
}));

/**
 * Test seam — reset the store to its initial state.
 */
export function resetRecipeStoreForTests(): void {
  useRecipeStore.setState(createInitialState());
}

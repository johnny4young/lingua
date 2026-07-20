/**
 * implementation — `useRecipeStore` tests.
 *
 * Transient state: overlay open / close, per-tab binding,
 * last-run results, in-flight flag.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetRecipeStoreForTests,
  useRecipeStore,
} from '../../src/renderer/stores/recipeStore';

beforeEach(() => {
  resetRecipeStoreForTests();
});

describe('useRecipeStore', () => {
  it('starts closed with empty maps', () => {
    const state = useRecipeStore.getState();
    expect(state.overlayOpen).toBe(false);
    expect(state.activeBindingForTab.size).toBe(0);
    expect(state.lastRunResults.size).toBe(0);
    expect(state.isRunning.size).toBe(0);
  });

  it('toggles overlay open / closed', () => {
    useRecipeStore.getState().openOverlay();
    expect(useRecipeStore.getState().overlayOpen).toBe(true);
    useRecipeStore.getState().closeOverlay();
    expect(useRecipeStore.getState().overlayOpen).toBe(false);
  });

  it('binds + unbinds recipes per tab id', () => {
    useRecipeStore.getState().bindRecipeToTab('tab-1', 'js-sort-objects');
    expect(useRecipeStore.getState().getBindingForTab('tab-1')).toBe(
      'js-sort-objects'
    );
    useRecipeStore.getState().unbindRecipe('tab-1');
    expect(useRecipeStore.getState().getBindingForTab('tab-1')).toBeUndefined();
  });

  it('clears prior run results when a new binding lands', () => {
    useRecipeStore.getState().bindRecipeToTab('tab-1', 'js-sort-objects');
    useRecipeStore.getState().setRunResults('tab-1', [
      { assertionId: 'a', status: 'pass' },
    ]);
    expect(useRecipeStore.getState().getRunResultsForTab('tab-1')).toHaveLength(
      1
    );
    useRecipeStore.getState().bindRecipeToTab('tab-1', 'js-palindrome');
    expect(useRecipeStore.getState().getRunResultsForTab('tab-1')).toHaveLength(
      0
    );
  });

  it('tracks isRunning per tab', () => {
    useRecipeStore.getState().setRunning('tab-1', true);
    expect(useRecipeStore.getState().isTabRunning('tab-1')).toBe(true);
    useRecipeStore.getState().setRunning('tab-1', false);
    expect(useRecipeStore.getState().isTabRunning('tab-1')).toBe(false);
  });

  it('unbind clears run results + running state for the tab', () => {
    useRecipeStore.getState().bindRecipeToTab('tab-1', 'js-fizzbuzz');
    useRecipeStore
      .getState()
      .setRunResults('tab-1', [{ assertionId: 'a', status: 'fail' }]);
    useRecipeStore.getState().setRunning('tab-1', true);
    useRecipeStore.getState().unbindRecipe('tab-1');
    expect(useRecipeStore.getState().getRunResultsForTab('tab-1')).toHaveLength(
      0
    );
    expect(useRecipeStore.getState().isTabRunning('tab-1')).toBe(false);
  });

  it('unbind defensively clears stale run state even without a binding entry', () => {
    useRecipeStore
      .getState()
      .setRunResults('tab-1', [{ assertionId: 'a', status: 'fail' }]);
    useRecipeStore.getState().setRunning('tab-1', true);

    useRecipeStore.getState().unbindRecipe('tab-1');

    expect(useRecipeStore.getState().getRunResultsForTab('tab-1')).toHaveLength(
      0
    );
    expect(useRecipeStore.getState().isTabRunning('tab-1')).toBe(false);
  });

  it('clearRunResults drops the entry', () => {
    useRecipeStore
      .getState()
      .setRunResults('tab-1', [{ assertionId: 'a', status: 'pass' }]);
    useRecipeStore.getState().clearRunResults('tab-1');
    expect(useRecipeStore.getState().getRunResultsForTab('tab-1')).toHaveLength(
      0
    );
  });

  it('bind to same recipe is idempotent (no state change)', () => {
    useRecipeStore.getState().bindRecipeToTab('tab-1', 'js-fizzbuzz');
    const before = useRecipeStore.getState().activeBindingForTab;
    useRecipeStore.getState().bindRecipeToTab('tab-1', 'js-fizzbuzz');
    expect(useRecipeStore.getState().activeBindingForTab).toBe(before);
  });
});

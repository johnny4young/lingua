/**
 * RL-039 Slice B — `<RecipesOverlay>` tests.
 *
 * Drives the overlay through the user-event surface:
 *   - Empty / unfiltered render shows every recipe.
 *   - Typing filters by title.
 *   - Selecting opens a new tab with starter code.
 *   - Cancel + Escape dismiss without writing.
 *   - ES locale renders in tuteo.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { RecipesOverlay } from '../../../src/renderer/components/Recipes/RecipesOverlay';
import { RECIPE_CATALOG } from '../../../src/renderer/data/recipes';
import {
  resetRecipeStoreForTests,
  useRecipeStore,
} from '../../../src/renderer/stores/recipeStore';
import { resetLessonProgressStoreForTests, useLessonProgressStore } from '../../../src/renderer/stores/lessonProgressStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';

beforeEach(() => {
  localStorage.clear();
  resetRecipeStoreForTests();
  resetLessonProgressStoreForTests();
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useUIStore.setState({ activeBottomPanel: 'console' });
  void i18next.changeLanguage('en');
});

describe('RecipesOverlay', () => {
  it('renders every catalog recipe by default', () => {
    render(<RecipesOverlay onClose={() => {}} />);
    expect(screen.getAllByTestId('recipes-list-row')).toHaveLength(
      RECIPE_CATALOG.length
    );
  });

  it('fuzzy-filters by title token', async () => {
    const user = userEvent.setup();
    render(<RecipesOverlay onClose={() => {}} />);
    const input = screen.getByTestId('recipes-search-input');
    await user.type(input, 'sort');
    await waitFor(() => {
      const rows = screen.getAllByTestId('recipes-list-row');
      expect(rows.length).toBeLessThan(RECIPE_CATALOG.length);
      expect(
        rows.some((row) => row.getAttribute('data-recipe-id') === 'js-sort-objects')
      ).toBe(true);
    });
  });

  it('shows empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<RecipesOverlay onClose={() => {}} />);
    const input = screen.getByTestId('recipes-search-input');
    await user.type(input, 'qwerty-no-match');
    await waitFor(() => {
      expect(screen.queryByTestId('recipes-empty')).toBeTruthy();
    });
  });

  it('clicking a row opens the recipe + flips the bottom panel + closes', async () => {
    const user = userEvent.setup();
    let closed = false;
    render(<RecipesOverlay onClose={() => (closed = true)} />);
    const sortRow = screen.getAllByTestId('recipes-list-row').find((row) =>
      row.getAttribute('data-recipe-id') === 'js-sort-objects'
    );
    expect(sortRow).toBeDefined();
    await user.click(sortRow!);
    expect(closed).toBe(true);
    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.recipeBindingId).toBe('js-sort-objects');
    expect(tabs[0]?.language).toBe('javascript');
    expect(useUIStore.getState().activeBottomPanel).toBe('recipe');
    expect(useLessonProgressStore.getState().getEntry('js-sort-objects')).toBeDefined();
  });

  it('keeps the overlay open when the editor store refuses a new recipe tab', async () => {
    const user = userEvent.setup();
    useEditorStore.setState({
      tabs: [
        {
          id: 'existing-tab',
          name: 'welcome.js',
          language: 'javascript',
          content: 'console.log("busy");',
          isDirty: false,
          workflowMode: 'scratchpad',
          runtimeMode: 'worker',
        },
      ],
      activeTabId: 'existing-tab',
    });
    let closed = false;
    render(<RecipesOverlay onClose={() => (closed = true)} />);
    const sortRow = screen.getAllByTestId('recipes-list-row').find((row) =>
      row.getAttribute('data-recipe-id') === 'js-sort-objects'
    );
    expect(sortRow).toBeDefined();

    await user.click(sortRow!);

    expect(closed).toBe(false);
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useRecipeStore.getState().getBindingForTab('existing-tab')).toBeUndefined();
    expect(useLessonProgressStore.getState().getEntry('js-sort-objects')).toBeUndefined();
    expect(useUIStore.getState().activeBottomPanel).toBe('console');
  });

  it('cancel button closes without writing to the editor store', async () => {
    const user = userEvent.setup();
    let closed = false;
    render(<RecipesOverlay onClose={() => (closed = true)} />);
    await user.click(screen.getByTestId('recipes-cancel'));
    expect(closed).toBe(true);
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it('Escape key closes', async () => {
    const user = userEvent.setup();
    let closed = false;
    render(<RecipesOverlay onClose={() => (closed = true)} />);
    await user.keyboard('{Escape}');
    expect(closed).toBe(true);
  });

  it('renders Spanish tuteo copy when locale flips to es', async () => {
    await i18next.changeLanguage('es');
    render(<RecipesOverlay onClose={() => {}} />);
    // Title in ES tuteo: "Recetas" not "Recetas (voseo)" — no voseo
    // possible on a noun, but the action buttons live nearby.
    expect(screen.getByText(/^Recetas$/i)).toBeTruthy();
    expect(screen.getByTestId('recipes-cancel').textContent).toMatch(/cancelar/i);
    expect(screen.getByTestId('recipes-open').textContent).toMatch(/abre la receta/i);
  });

  it('arrow-down moves the active selection', async () => {
    const user = userEvent.setup();
    render(<RecipesOverlay onClose={() => {}} />);
    // Initial active is index 0.
    const initial = screen.getAllByTestId('recipes-list-row')[0];
    expect(initial?.getAttribute('data-active')).toBe('true');
    await user.keyboard('{ArrowDown}');
    const rows = screen.getAllByTestId('recipes-list-row');
    expect(rows[1]?.getAttribute('data-active')).toBe('true');
    expect(rows[0]?.getAttribute('data-active')).toBe('false');
  });

  it('respects the all/javascript language filter', async () => {
    const user = userEvent.setup();
    render(<RecipesOverlay onClose={() => {}} />);
    await user.click(screen.getByTestId('recipes-filter-javascript'));
    expect(screen.getAllByTestId('recipes-list-row')).toHaveLength(
      RECIPE_CATALOG.length
    );
  });

  // Ignore noisy unused vars by binding to discard local.
  void vi;
});

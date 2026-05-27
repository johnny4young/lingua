/**
 * RL-039 Slice B — Bundled recipe catalog audits.
 *
 * Pins:
 *   - All 10 recipes load + parse cleanly via `parseLessonPack`.
 *   - Ids are unique.
 *   - Every recipe has ≥2 assertions.
 *   - Every recipe targets `javascript` (Slice B contract).
 *   - `getRecipeById` round-trip works.
 */

import { describe, expect, it } from 'vitest';
import { RECIPE_CATALOG, getRecipeById } from '../../src/renderer/data/recipes';
import { parseLessonPack } from '../../src/shared/lessonPack';

describe('RECIPE_CATALOG', () => {
  it('ships 10 recipes Slice B', () => {
    expect(RECIPE_CATALOG).toHaveLength(10);
  });

  it('every recipe parses cleanly', () => {
    for (const recipe of RECIPE_CATALOG) {
      const outcome = parseLessonPack(recipe);
      expect(outcome.ok, `recipe ${recipe.id} failed to parse`).toBe(true);
    }
  });

  it('recipe ids are unique', () => {
    const ids = RECIPE_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every recipe has ≥2 assertions', () => {
    for (const recipe of RECIPE_CATALOG) {
      expect(
        recipe.assertions.length,
        `${recipe.id} has fewer than 2 assertions`
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('every Slice B recipe targets JavaScript', () => {
    for (const recipe of RECIPE_CATALOG) {
      expect(recipe.language).toBe('javascript');
    }
  });

  it('every recipe carries en + es prose for title and prompt', () => {
    for (const recipe of RECIPE_CATALOG) {
      expect(recipe.title.en.length).toBeGreaterThan(0);
      expect(recipe.title.es).toBeDefined();
      expect(recipe.prompt.en.length).toBeGreaterThan(0);
      expect(recipe.prompt.es).toBeDefined();
    }
  });
});

describe('getRecipeById', () => {
  it('returns the recipe when present', () => {
    expect(getRecipeById('js-sort-objects')?.id).toBe('js-sort-objects');
  });

  it('returns undefined for unknown ids', () => {
    expect(getRecipeById('not-a-recipe')).toBeUndefined();
  });
});

/**
 * RL-039 Slices B/C — Bundled recipe catalog audits.
 *
 * Pins:
 *   - All 16 recipes load + parse cleanly via `parseLessonPack`.
 *   - Ids are unique.
 *   - Every recipe has ≥2 assertions.
 *   - Catalog counts stay pinned per supported language.
 *   - `getRecipeById` round-trip works.
 */

import { describe, expect, it } from 'vitest';
import { RECIPE_CATALOG, getRecipeById } from '../../src/renderer/data/recipes';
import { parseLessonPack } from '../../src/shared/lessonPack';

describe('RECIPE_CATALOG', () => {
  it('ships 10 JavaScript + 3 TypeScript + 3 Python recipes', () => {
    expect(RECIPE_CATALOG).toHaveLength(16);
    const countFor = (language: string) =>
      RECIPE_CATALOG.filter((recipe) => recipe.language === language).length;
    expect(countFor('javascript')).toBe(10);
    expect(countFor('typescript')).toBe(3);
    expect(countFor('python')).toBe(3);
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

  it('every recipe uses the language-specific id prefix', () => {
    const prefixByLanguage = {
      javascript: 'js-',
      typescript: 'ts-',
      python: 'py-',
    } as const;
    for (const recipe of RECIPE_CATALOG) {
      const prefix = prefixByLanguage[
        recipe.language as keyof typeof prefixByLanguage
      ];
      expect(prefix, `unsupported recipe language ${recipe.language}`).toBeDefined();
      expect(recipe.id.startsWith(prefix!)).toBe(true);
    }
  });

  it('every recipe carries en + es prose for title and prompt', () => {
    for (const recipe of RECIPE_CATALOG) {
      expect(recipe.title.en.length).toBeGreaterThan(0);
      expect(recipe.title.es).toBeDefined();
      expect(recipe.prompt.en.length).toBeGreaterThan(0);
      expect(recipe.prompt.es).toBeDefined();
      for (const assertion of recipe.assertions) {
        expect(assertion.name.en.length).toBeGreaterThan(0);
        expect(assertion.name.es).toBeDefined();
        if (assertion.hint) {
          expect(assertion.hint.en.length).toBeGreaterThan(0);
          expect(assertion.hint.es).toBeDefined();
        }
      }
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

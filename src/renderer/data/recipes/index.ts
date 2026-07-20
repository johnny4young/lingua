/**
 * implementation — Recipe catalog barrel.
 *
 * Lists every bundled recipe in the order they appear in the
 * overlay list. Each entry is a TypeScript const matching
 * `LessonPackV1` so `tsc --noEmit` catches schema drift at build
 * time (no need to run `parseLessonPack` over the catalog at
 * runtime). The runtime parse path is reserved for future work when
 * user-authored recipes land via the internal importer registry.
 *
 * Adding a recipe means:
 *   1. Author `./<id>.ts` with `export const recipe: LessonPackV1 = …`.
 *   2. Append the import + spread to `RECIPE_CATALOG` below.
 *   3. Pin coverage in `tests/data/recipes.test.ts` (the existing
 *      "every recipe parses" + "ids are unique" cases already
 *      cover the new entry).
 */

import type { LessonPackV1 } from '../../../shared/lessonPack';
import { recipe as jsArrayChunk } from './js-array-chunk';
import { recipe as jsArrayDeduplicate } from './js-array-deduplicate';
import { recipe as jsCountVowels } from './js-count-vowels';
import { recipe as jsFindDuplicates } from './js-find-duplicates';
import { recipe as jsFizzbuzz } from './js-fizzbuzz';
import { recipe as jsFlattenArray } from './js-flatten-array';
import { recipe as jsObjectDeepClone } from './js-object-deep-clone';
import { recipe as jsPalindrome } from './js-palindrome';
import { recipe as jsSortObjects } from './js-sort-objects';
import { recipe as jsStringAnagram } from './js-string-anagram';
import { recipe as pyGroupRecords } from './py-group-records';
import { recipe as pySlidingWindowMaximum } from './py-sliding-window-maximum';
import { recipe as pyWordFrequency } from './py-word-frequency';
import { recipe as tsDiscriminatedUnionArea } from './ts-discriminated-union-area';
import { recipe as tsGenericKeyBy } from './ts-generic-key-by';
import { recipe as tsGroupByProperty } from './ts-group-by-property';

/**
 * Ordered list of bundled recipes. The order is what the overlay
 * shows when the search box is empty — beginner-friendly recipes
 * first (count vowels, FizzBuzz), then the medium ones, then the
 * conceptually harder (deep clone, palindrome). The TypeScript and
 * Python implementation packs follow as language-specific practice groups.
 * A future implementation may promote/demote based on completion telemetry,
 * but the bundled catalog fixes the order in code.
 */
export const RECIPE_CATALOG: ReadonlyArray<LessonPackV1> = [
  jsCountVowels,
  jsFizzbuzz,
  jsSortObjects,
  jsArrayDeduplicate,
  jsArrayChunk,
  jsFindDuplicates,
  jsStringAnagram,
  jsPalindrome,
  jsFlattenArray,
  jsObjectDeepClone,
  tsGenericKeyBy,
  tsGroupByProperty,
  tsDiscriminatedUnionArea,
  pyWordFrequency,
  pyGroupRecords,
  pySlidingWindowMaximum,
];

/**
 * Look up a recipe by id. Returns `undefined` when missing so the
 * tab-binding restore path can drop orphan ids gracefully (mirror of
 * `getImporter` + `getUtilityAdapter` semantics).
 */
export function getRecipeById(id: string): LessonPackV1 | undefined {
  return RECIPE_CATALOG.find((entry) => entry.id === id);
}

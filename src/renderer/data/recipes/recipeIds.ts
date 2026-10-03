/**
 * Ids of the bundled recipes, kept apart from their bodies so the startup
 * shell can validate a tab's recipe binding without loading the catalog.
 * `tests/data/recipes.test.ts` pins this list to `RECIPE_CATALOG`.
 */
const RECIPE_IDS: ReadonlySet<string> = new Set([
  'js-array-chunk',
  'js-array-deduplicate',
  'js-count-vowels',
  'js-find-duplicates',
  'js-fizzbuzz',
  'js-flatten-array',
  'js-object-deep-clone',
  'js-palindrome',
  'js-sort-objects',
  'js-string-anagram',
  'py-group-records',
  'py-sliding-window-maximum',
  'py-word-frequency',
  'ts-discriminated-union-area',
  'ts-generic-key-by',
  'ts-group-by-property',
]);

export function isBundledRecipeId(id: string): boolean {
  return RECIPE_IDS.has(id);
}

import type { LanguagePackId } from './languagePacks';

/**
 * Recipe language capability policy.
 *
 * Keep this synchronous, dependency-light gate separate from the assertion
 * composer/parser in lessonRunner. Save-As needs the policy during normal
 * editor persistence, while the full recipe engine belongs to lazy Recipes
 * surfaces.
 */
export const RECIPE_RUNNABLE_LANGUAGE_IDS = [
  'javascript',
  'typescript',
  'python',
] as const satisfies ReadonlyArray<LanguagePackId>;

export type RecipeRunnableLanguage = (typeof RECIPE_RUNNABLE_LANGUAGE_IDS)[number];

export const RECIPE_RUNNABLE_LANGUAGES: ReadonlySet<string> = new Set(RECIPE_RUNNABLE_LANGUAGE_IDS);

export function isRecipeRunnableLanguage(language: string): language is RecipeRunnableLanguage {
  return RECIPE_RUNNABLE_LANGUAGES.has(language);
}

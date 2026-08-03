import { describe, expect, it } from 'vitest';
import {
  isRecipeRunnableLanguage,
  RECIPE_RUNNABLE_LANGUAGE_IDS,
} from '../../src/shared/recipeLanguages';

describe('recipe language policy', () => {
  it('exposes the exact runnable recipe language tuple', () => {
    expect(RECIPE_RUNNABLE_LANGUAGE_IDS).toEqual(['javascript', 'typescript', 'python']);
  });

  it('allows JavaScript, TypeScript, and Python', () => {
    expect(isRecipeRunnableLanguage('javascript')).toBe(true);
    expect(isRecipeRunnableLanguage('typescript')).toBe(true);
    expect(isRecipeRunnableLanguage('python')).toBe(true);
  });

  it('blocks unsupported recipe languages', () => {
    expect(isRecipeRunnableLanguage('go')).toBe(false);
  });
});

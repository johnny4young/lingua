import type { Language } from '../types';
import { executionModeForLanguage } from './languageMeta';

const INLINE_RESULT_LANGUAGES = new Set<Language>(['javascript', 'typescript', 'python']);

export function isInlineResultLanguage(language: Language): boolean {
  return INLINE_RESULT_LANGUAGES.has(language);
}

export function isValidationLanguage(language: Language): boolean {
  return executionModeForLanguage(language) === 'validate';
}

export function isViewOnlyLanguage(language: Language): boolean {
  return executionModeForLanguage(language) === 'view';
}

export function supportsRunnableSurface(language: Language): boolean {
  return executionModeForLanguage(language) === 'run';
}

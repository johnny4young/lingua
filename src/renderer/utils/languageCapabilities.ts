import type { Language } from '../types/language';

const INLINE_RESULT_LANGUAGES = new Set<Language>(['javascript', 'typescript', 'python']);

export function isInlineResultLanguage(language: Language): boolean {
  return INLINE_RESULT_LANGUAGES.has(language);
}

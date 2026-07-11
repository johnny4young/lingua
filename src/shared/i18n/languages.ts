/**
 * Locale metadata without catalog imports. Renderer bootstrap consumes this
 * module so selecting/coercing a language does not pull every JSON catalog into
 * the initial bundle; main-process translation can still use resources.ts.
 */

export const COMMON_NAMESPACE = 'common';
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(
  language: string
): language is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

export function coerceSupportedLanguage(
  language: string
): SupportedLanguage {
  return isSupportedLanguage(language) ? language : 'en';
}

export function resolveSystemLanguage(
  systemLanguages: readonly string[]
): SupportedLanguage {
  for (const tag of systemLanguages) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base && isSupportedLanguage(base)) {
      return base;
    }
  }

  return 'en';
}

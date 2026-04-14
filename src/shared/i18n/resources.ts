import en from '../../renderer/i18n/locales/en/common.json';
import es from '../../renderer/i18n/locales/es/common.json';

export const COMMON_NAMESPACE = 'common';
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const COMMON_RESOURCES = {
  en: { [COMMON_NAMESPACE]: en },
  es: { [COMMON_NAMESPACE]: es },
} as const;

export function isSupportedLanguage(language: string): language is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

export function coerceSupportedLanguage(language: string): SupportedLanguage {
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

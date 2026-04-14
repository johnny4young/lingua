import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { AppLanguage } from '../types';
import en from './locales/en/common.json';
import es from './locales/es/common.json';

const SUPPORTED_LANGUAGES = ['en', 'es'] as const;

function isSupportedLanguage(language: string): language is (typeof SUPPORTED_LANGUAGES)[number] {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

function coerceSupportedLanguage(language: string): (typeof SUPPORTED_LANGUAGES)[number] {
  return isSupportedLanguage(language) ? language : 'en';
}

function updateDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

export function getBrowserSystemLanguages(
  browserNavigator:
    | Pick<Navigator, 'languages' | 'language'>
    | undefined = typeof navigator !== 'undefined' ? navigator : undefined
): string[] {
  if (browserNavigator && Array.isArray(browserNavigator.languages)) {
    const languages = browserNavigator.languages.filter(Boolean);
    if (languages.length > 0) {
      return [...languages];
    }
  }

  if (browserNavigator?.language) {
    return [browserNavigator.language];
  }

  return ['en'];
}

/**
 * Resolve a list of BCP 47 locale strings to the best supported language.
 * Strips region codes (e.g. `es-MX` -> `es`) and returns the first match,
 * or `'en'` when nothing matches.
 */
export function resolveSystemLanguage(
  systemLanguages: readonly string[]
): string {
  for (const tag of systemLanguages) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base && (SUPPORTED_LANGUAGES as readonly string[]).includes(base)) {
      return base;
    }
  }
  return 'en';
}

let initialized = false;

/**
 * Initialise i18next synchronously with bundled resources.
 * Must be called once before React renders.
 *
 * The `initReactI18next` plugin is bound here so that `useTranslation()`
 * works in any component without an explicit provider.
 */
export function initI18n(language: string): typeof i18next {
  const resolvedLanguage = coerceSupportedLanguage(language);

  if (initialized) {
    // Already initialised — just switch the language.
    void i18next.changeLanguage(resolvedLanguage);
    updateDocumentLanguage(resolvedLanguage);
    return i18next;
  }

  initialized = true;

  i18next.use(initReactI18next).init({
    lng: resolvedLanguage,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    initAsync: false,
    resources: {
      en: { common: en },
      es: { common: es },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  updateDocumentLanguage(resolvedLanguage);

  return i18next;
}

/**
 * Switch the active language at runtime.
 * Resolves `'system'` via the provided callback before calling `changeLanguage`.
 */
export async function changeAppLanguage(
  language: AppLanguage,
  getSystemLanguages: () => Promise<string[]>
): Promise<void> {
  let resolved = language as string;
  if (language === 'system') {
    try {
      const systemLangs = await getSystemLanguages();
      resolved = resolveSystemLanguage(systemLangs);
    } catch {
      resolved = 'en';
    }
  }
  await i18next.changeLanguage(resolved);
  updateDocumentLanguage(resolved);
}

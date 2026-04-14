import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { AppLanguage } from '../types';
import {
  COMMON_NAMESPACE,
  COMMON_RESOURCES,
  coerceSupportedLanguage,
  resolveSystemLanguage,
} from '../../shared/i18n/resources';

function updateDocumentLanguage(language: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
}

/**
 * Returns the current active app language, tolerating the case where
 * i18next has not been initialized yet (e.g. during early bootstrap or
 * isolated unit tests). Always resolves to a supported language string
 * that can safely be forwarded to `translateCommon` or sent over IPC.
 */
export function getActiveAppLanguage(): string {
  return coerceSupportedLanguage(
    i18next.resolvedLanguage ?? i18next.language ?? 'en'
  );
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
    defaultNS: COMMON_NAMESPACE,
    ns: [COMMON_NAMESPACE],
    initAsync: false,
    resources: COMMON_RESOURCES,
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

export { resolveSystemLanguage };

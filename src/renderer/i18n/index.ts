import i18next from 'i18next';
import type { TOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { AppLanguage } from '../types';
import en from './locales/en/common.json';
import {
  COMMON_NAMESPACE,
  coerceSupportedLanguage,
  resolveSystemLanguage,
  type SupportedLanguage,
} from '../../shared/i18n/languages';

type CommonCatalog = typeof en;

const loadedCatalogs: Partial<Record<SupportedLanguage, CommonCatalog>> = {
  en,
};
let spanishCatalogPromise: Promise<CommonCatalog> | null = null;

async function loadCatalog(language: SupportedLanguage): Promise<CommonCatalog> {
  if (language === 'en') return en;
  if (loadedCatalogs.es) return loadedCatalogs.es;
  spanishCatalogPromise ??= import('./locales/es/common.json').then(
    (module) => module.default
  );
  const catalog = await spanishCatalogPromise;
  loadedCatalogs.es = catalog;
  if (initialized) {
    i18next.addResourceBundle('es', COMMON_NAMESPACE, catalog, true, true);
  }
  return catalog;
}

function rendererResources() {
  return {
    en: { [COMMON_NAMESPACE]: en },
    ...(loadedCatalogs.es
      ? { es: { [COMMON_NAMESPACE]: loadedCatalogs.es } }
      : {}),
  };
}

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

/** Renderer/web translation without importing the main-process catalog. */
export function translateAppCommon(
  key: string,
  options?: TOptions
): string {
  return i18next.t(key, options);
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
export async function initI18n(language: string): Promise<typeof i18next> {
  const resolvedLanguage = coerceSupportedLanguage(language);
  if (resolvedLanguage === 'es') {
    await loadCatalog('es');
  }

  if (initialized) {
    // Already initialised — just switch the language after its lazy catalog is
    // available. English remains synchronous because it is the boot fallback.
    await i18next.changeLanguage(resolvedLanguage);
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
    resources: rendererResources(),
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
  const supported = coerceSupportedLanguage(resolved);
  if (supported === 'es') {
    await loadCatalog('es');
  }
  await i18next.changeLanguage(supported);
  updateDocumentLanguage(supported);
}

export { resolveSystemLanguage };

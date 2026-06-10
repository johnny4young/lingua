/**
 * Shared locale catalog used by BOTH processes: the renderer's i18next
 * bootstrap and the main-process `runtime.ts` instance behind the
 * fileSystem / profile / recovery IPC handlers.
 *
 * Layering note: these are the only `src/shared` imports that reach
 * into `src/renderer`, and they are deliberate — the imports are pure
 * JSON *data* (the locale catalogs), not renderer code. The catalogs
 * stay under `src/renderer/i18n/locales` because the i18n tooling
 * (`check-i18n.mjs`, `check-renderer-copy.mjs`, translator workflow)
 * anchors on that path. Do not import renderer *code* from shared.
 */
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

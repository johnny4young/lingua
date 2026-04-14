import { createInstance } from 'i18next';
import type { TOptions } from 'i18next';
import {
  COMMON_NAMESPACE,
  COMMON_RESOURCES,
  coerceSupportedLanguage,
} from './resources';

let runtimeI18n: ReturnType<typeof createInstance> | null = null;

function getRuntimeI18n() {
  if (runtimeI18n) {
    return runtimeI18n;
  }

  runtimeI18n = createInstance();
  void runtimeI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: COMMON_NAMESPACE,
    ns: [COMMON_NAMESPACE],
    initAsync: false,
    resources: COMMON_RESOURCES,
    interpolation: { escapeValue: false },
  });

  return runtimeI18n;
}

export function translateCommon(
  language: string,
  key: string,
  options?: TOptions
): string {
  return getRuntimeI18n().t(key, {
    lng: coerceSupportedLanguage(language),
    ...options,
  });
}

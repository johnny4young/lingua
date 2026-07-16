import { coerceSupportedLanguage } from '../../shared/i18n/languages';
import { getActiveAppLanguage } from './index';

const NUMBER_FORMATTERS = {
  en: new Intl.NumberFormat('en'),
  es: new Intl.NumberFormat('es'),
} as const;

/**
 * Format user-facing numbers with Lingua's active application locale rather
 * than the host OS locale. Passing the language from `useTranslation()` keeps
 * the caller reactive when Settings switches language at runtime.
 */
export function formatNumber(
  value: number | bigint,
  language: string = getActiveAppLanguage()
): string {
  return NUMBER_FORMATTERS[coerceSupportedLanguage(language)].format(value);
}

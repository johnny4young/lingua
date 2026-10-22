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

const COMPACT_FORMATTERS = {
  en: new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }),
  es: new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 }),
} as const;

/** `1.2M`, `310K`: for estimates, where the exact digits mean nothing. */
export function formatCompactNumber(value: number, language: string = getActiveAppLanguage()): string {
  return COMPACT_FORMATTERS[coerceSupportedLanguage(language)].format(value);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** `214 MB` in the active locale, in powers of 1024. */
export function formatByteSize(bytes: number, language: string = getActiveAppLanguage()): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(coerceSupportedLanguage(language), {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}

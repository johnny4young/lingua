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

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;
/** Whole bytes, and one decimal for a value under 10 of a larger unit. */
const BYTE_FORMATTERS = {
  en: [new Intl.NumberFormat('en', { maximumFractionDigits: 0 }), new Intl.NumberFormat('en', { maximumFractionDigits: 1 })],
  es: [new Intl.NumberFormat('es', { maximumFractionDigits: 0 }), new Intl.NumberFormat('es', { maximumFractionDigits: 1 })],
} as const;

/** `917 B`, `3.1 kB`, `214 MB` in the active locale, in powers of 1024. Intl's short `byte` reads `917 byte`. */
export function formatByteSize(bytes: number, language: string = getActiveAppLanguage()): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = BYTE_FORMATTERS[coerceSupportedLanguage(language)][value < 10 && unit > 0 ? 1 : 0].format(value);
  return `${number} ${BYTE_UNITS[unit]}`;
}

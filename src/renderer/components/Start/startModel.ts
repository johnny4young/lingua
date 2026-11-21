import type { TFunction } from 'i18next';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import { resolveTemplateLabel, type Template } from '../../data/templates';
import type { Language } from '../../types/language';
import type { NativeJsRuntimeStatus } from '../../utils/nativeJsRuntimeStatus';
import { isNativeLanguageToolchain } from '../../utils/nativeLanguageToolchainStatus';
import type { LastAnswer } from '../../utils/lastAnswer';

/** Every runnable language, the ones that run without a host toolchain first. */
export const START_LANGUAGES: readonly Language[] = LANGUAGE_PACKS.filter(
  pack => pack.execution === 'run' || pack.execution === 'compile'
)
  .map(pack => pack.id as Language)
  .sort((a, b) => Number(isNativeLanguageToolchain(a)) - Number(isNativeLanguageToolchain(b)));

export type LanguageAvailability =
  | { kind: 'offline' }
  | { kind: 'browser' }
  | { kind: 'desktopOnly' }
  | { kind: 'toolchain'; status: NativeJsRuntimeStatus };

export function languageAvailability(
  language: Language,
  isWeb: boolean,
  toolchainStatus: NativeJsRuntimeStatus | null
): LanguageAvailability {
  if (isNativeLanguageToolchain(language)) {
    return isWeb ? { kind: 'desktopOnly' } : { kind: 'toolchain', status: toolchainStatus ?? 'checking' };
  }
  return isWeb ? { kind: 'browser' } : { kind: 'offline' };
}

export interface TemplateRow {
  label: string;
  /** One template per language, in catalog order. */
  templates: Template[];
}

/** Templates that share a label read as one row with a badge per language. */
export function templateRows(templates: readonly Template[], t: TFunction, filter: Language | null): TemplateRow[] {
  const rows = new Map<string, TemplateRow>();
  for (const template of templates) {
    if (filter && template.language !== filter) continue;
    const label = resolveTemplateLabel(template, t);
    const row = rows.get(label) ?? { label, templates: [] };
    row.templates.push(template);
    rows.set(label, row);
  }
  return [...rows.values()];
}

/** Languages that own at least one template, in the order the catalog lists them. */
export function templateLanguages(templates: readonly Template[]): Language[] {
  return [...new Set(templates.map(template => template.language))];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `2 hr. ago`, `yesterday`, a weekday inside a week, then a date. */
export function startTimeAgo(ranAt: number, now: number, locale: string): string {
  const elapsed = Math.max(0, now - ranAt);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (elapsed < MINUTE) return relative.format(0, 'second');
  if (elapsed < HOUR) return relative.format(-Math.round(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.round(elapsed / HOUR), 'hour');
  const days = Math.round((startOfDay(now) - startOfDay(ranAt)) / DAY);
  if (days <= 1) return relative.format(-1, 'day');
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(ranAt);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ranAt);
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The small word after the numeral: `rows`, `OK`, `of 6 failed`, `s`. */
export function answerUnit(answer: LastAnswer, t: TFunction): string | undefined {
  switch (answer.unit) {
    case 'rows':
      return t('start.answer.rows', { count: Number(answer.numeral.replace(/\D/g, '')) || 0 });
    case 'status':
      return answer.label;
    case 'items':
      return t('start.answer.items', { count: answer.total ?? 0 });
    case 'failed':
      return t('start.answer.failed', { count: answer.total ?? 0 });
    case 'passed':
      return t('start.answer.passed', { count: answer.total ?? 0 });
    default:
      return answer.label;
  }
}

/** What fills the numeral slot when a run left no value. */
export function answerFallback(answer: LastAnswer, t: TFunction): string {
  if (answer.status === 'error') return answer.label ?? t('start.answer.error');
  if (answer.status === 'timeout') return t('start.answer.timeout');
  if (answer.status === 'stopped') return t('start.answer.stopped');
  return t('start.answer.noValue');
}

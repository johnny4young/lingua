import type { TFunction } from 'i18next';
import type { Language } from '../../types/language';
import type { LastAnswer } from '../../utils/lastAnswer';

/** Badge and name for a row that shows an answer: SQL and HTTP rows go by what answered. */
export function answerIdentity(
  tab: { kind?: string; language: Language; name: string },
  answer: LastAnswer | undefined
): { badge: Language; name: string; workspace: boolean } {
  const workspace = tab.kind === 'sql' || tab.kind === 'http';
  return {
    badge: (workspace ? tab.kind : tab.language) as Language,
    name: workspace && answer?.subject ? answer.subject : tab.name,
    workspace,
  };
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
    case 'passed':
      return t(`start.answer.${answer.unit}`, { count: Number(answer.numeral) || 0, total: answer.total ?? 0 });
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

/** The numeral slot, its unit, and whether the run failed, as every answer row draws them. */
export function answerDisplay(answer: LastAnswer, t: TFunction): { value: string; unit?: string; failed: boolean } {
  const unit = answer.numeral ? answerUnit(answer, t) : undefined;
  return {
    value: answer.numeral || answerFallback(answer, t),
    ...(unit ? { unit } : {}),
    failed: answer.status !== 'ok' || answer.unit === 'failed',
  };
}

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnswerContext } from './answerObjectModel';

/** The locale answers read in, and the moment they appeared, which relative times count from. */
export function useAnswerContext(): AnswerContext {
  const { i18n } = useTranslation();
  const [now] = useState(Date.now);
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return useMemo(() => ({ now, locale }), [now, locale]);
}

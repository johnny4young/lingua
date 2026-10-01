import type { AiChatResult } from './aiClient';
import type { TFunction } from 'i18next';

/** Localize transport budgets without placing i18n inside the transport. */
export function aiFailureMessage(
  result: Extract<AiChatResult, { ok: false }>,
  t: TFunction
): string {
  if (result.kind === 'limit') return t('ai.response.limit');
  if (result.kind === 'cancelled') return t('ai.response.cancelled');
  if (result.kind === 'timeout') return t('ai.response.timeout');
  return result.message;
}

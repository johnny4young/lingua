import type { AiChatResult } from './aiClient';
import type { TFunction } from 'i18next';
// English copy for the local-server hint ships with the AI surfaces, not the boot catalog.
import '../i18n/explainCatalog';

/** Budget notices are complete sentences; other failures keep the surface's wrapper. */
export function aiFailureMessage(
  result: Extract<AiChatResult, { ok: false }>,
  t: TFunction,
  wrapKey: 'ai.explain.failed' | 'utilities.tool.cron.phrase.ai.error' = 'ai.explain.failed'
): string {
  if (result.kind === 'limit') return t('ai.response.limit');
  if (result.kind === 'cancelled') return t('ai.response.cancelled');
  if (result.kind === 'timeout') return t('ai.response.timeout');
  if (result.kind === 'network' && result.localHost)
    return t('ai.response.localUnreachable', { host: result.localHost });
  return t(wrapKey, { message: result.message });
}

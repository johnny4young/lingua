import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '../../../shared/utilities/registry';
import { UTILITY_ADAPTER_IDS, type UtilityAdapterId } from '../../../shared/utilities/types';
import '../../i18n/clipboardChainsCatalog';

/** A menu of utilities that resets after each pick, as a pick is an action and not a value. */
export function SendOutputSelect({ onSend, testId }: { onSend: (utilityId: UtilityAdapterId) => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <label className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-caption font-medium text-muted focus-within:border-border-strong">
      <Send size={11} aria-hidden="true" />
      <select
        value=""
        data-testid={testId}
        aria-label={t('utilityPipeline.send.label')}
        onChange={(event) => onSend(event.target.value as UtilityAdapterId)}
        className="max-w-[10rem] bg-transparent text-caption focus:outline-none"
      >
        <option value="" disabled>
          {t('utilityPipeline.send.label')}
        </option>
        {UTILITY_ADAPTER_IDS.map((id) => (
          <option key={id} value={id}>
            {t(getAdapter(id)?.titleKey ?? id)}
          </option>
        ))}
      </select>
    </label>
  );
}

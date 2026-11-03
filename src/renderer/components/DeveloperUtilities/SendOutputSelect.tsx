import { Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '../../../shared/utilities/registry';
import { UTILITY_ADAPTER_IDS, type UtilityAdapterId } from '../../../shared/utilities/types';
import '../../i18n/clipboardChainsCatalog';

/** The pick and the action are separate: a closed select fires change on arrow keys on Windows and Linux. */
export function SendOutputSelect({ onSend, testId }: { onSend: (utilityId: UtilityAdapterId) => void; testId: string }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<UtilityAdapterId | ''>('');
  return (
    <span className="inline-flex items-center gap-1">
      <label className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-2 text-caption font-medium text-muted focus-within:border-border-strong">
        <Send size={11} aria-hidden="true" />
        <select
          value={picked}
          data-testid={testId}
          aria-label={t('utilityPipeline.send.label')}
          onChange={(event) => setPicked(event.target.value as UtilityAdapterId)}
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
      <button
        type="button"
        disabled={picked === ''}
        data-testid={`${testId}-go`}
        onClick={() => {
          if (picked === '') return;
          setPicked('');
          onSend(picked);
        }}
        className="focus-ring inline-flex h-7 items-center rounded-md border border-border/60 bg-surface/40 px-2 text-caption font-medium text-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('utilityPipeline.send.action')}
      </button>
    </span>
  );
}

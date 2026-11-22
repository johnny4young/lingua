import { useTranslation } from 'react-i18next';
import { ProChip } from '../ui/ProChip';
import { TypeTag } from '../ui/answer';
import { CAPSULE_LRU_CAP } from '../../stores/executionHistoryStore';

/** Free keeps its own last run open; the PRO chip says the rest of the list is the paid part. */
export function CapsuleFreeGate({ kept, earlier }: { kept: number; earlier: number }) {
  const { t } = useTranslation();
  return (
    <div data-testid="capsule-list-upsell" className="m-3.5 shrink-0 rounded-[10px] border border-border-default bg-bg-base p-3.5">
      <div className="flex items-center gap-2 whitespace-nowrap">
        <TypeTag className="text-fg-base">
          <span data-testid="capsule-list-quota">{t('capsuleList.gate.quota', { count: kept, max: CAPSULE_LRU_CAP })}</span>
        </TypeTag>
        <span className="flex-1" />
        <span data-testid="capsule-list-free-slice">
          <ProChip />
        </span>
      </div>
      <p className="mt-2 text-body-sm leading-[17px] text-fg-muted">
        {earlier > 0 ? `${t('capsuleList.gate.earlier', { count: earlier })} ` : null}
        {t('capsuleList.gate.proLets')}
      </p>
    </div>
  );
}

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpFromLine, Package } from 'lucide-react';
import { CAPSULE_LRU_CAP } from '../../stores/executionHistoryStore';
import { ModalShell } from '../ui/ModalShell';
import { EmptyState } from '../ui/EmptyState';
import { CapsuleDialogHeader, CapsuleRowCells } from './CapsuleBrowserParts';
import { CapsuleDetail } from './CapsuleDetail';
import { CAPSULE_ROW_GRID, type CapsuleBrowserRow } from './capsuleBrowserRows';

/** Free shows its own last run read-only; browsing every capsule is the Pro part. */
export function CapsuleFreeGate({
  runs,
  onClose,
  onImport,
  onUpgrade,
}: {
  runs: readonly CapsuleBrowserRow[];
  onClose: () => void;
  onImport: () => void;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [now] = useState(() => Date.now());
  const last = runs[0];

  return (
    <ModalShell
      size="max-w-[860px]"
      onClose={onClose}
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('capsuleList.overlay.close')}
      bodyClassName="px-[18px] py-4"
      bodyMaxHeightClassName="max-h-[min(64vh,560px)]"
      header={
        <CapsuleDialogHeader
          titleId={titleId}
          trailing={
            <>
              <span data-testid="capsule-list-quota" className="shrink-0 rounded-md border border-border-subtle px-2 py-0.5 font-mono text-eyebrow uppercase tracking-wide text-fg-muted">
                {t('capsuleList.gate.quota', { count: runs.length, max: CAPSULE_LRU_CAP })}
              </span>
              <ImportButton onImport={onImport} />
            </>
          }
        />
      }
      footerLegend={<span className="text-caption text-fg-muted">{t('capsuleList.gate.pro')}</span>}
      trailing={
        <button type="button" onClick={onUpgrade} data-testid="capsule-list-upsell-cta" className="button-primary">
          {t('capsuleList.upsell.cta')}
        </button>
      }
    >
      <div data-testid="capsule-list-upsell">
        {last ? (
          <section aria-labelledby={`${titleId}-last`}>
            <h3 id={`${titleId}-last`} className="mb-2 font-mono text-eyebrow font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              {t('capsuleList.gate.lastRun')}
            </h3>
            <div data-testid="capsule-list-row" className={`${CAPSULE_ROW_GRID} mb-4 h-[44px] rounded-lg border border-border-subtle px-3`}>
              <CapsuleRowCells row={last} now={now} />
            </div>
            <CapsuleDetail capsule={last.capsule} />
          </section>
        ) : (
          <EmptyState
            className="py-10"
            icon={<Package size={18} aria-hidden="true" />}
            title={<span data-testid="capsule-list-empty">{t('capsuleList.empty.title')}</span>}
            description={t('capsuleList.empty.hint')}
          />
        )}
      </div>
    </ModalShell>
  );
}

export function ImportButton({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onImport}
      data-testid="capsule-list-import"
      className="focus-ring inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-panel px-2.5 text-caption font-medium text-fg-base hover:border-border-strong"
    >
      <ArrowUpFromLine size={11} aria-hidden="true" />
      {t('capsuleList.import')}
    </button>
  );
}

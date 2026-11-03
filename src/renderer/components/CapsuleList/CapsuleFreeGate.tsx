import { useId, useState } from 'react';
import { useTeachingPaywall } from '../../hooks/useProAccess';
import { ProChip } from '../ui/ProChip';
import { useTranslation } from 'react-i18next';
import { ArrowUpFromLine, Package } from 'lucide-react';
import { FREE_TIER_LIMITS } from '../../../shared/entitlements';
import { CAPSULE_LRU_CAP } from '../../stores/executionHistoryStore';
import { ModalShell } from '../ui/ModalShell';
import { EmptyState } from '../ui/EmptyState';
import { CapsuleDialogHeader, CapsuleRowCells } from './CapsuleBrowserParts';
import { CapsuleDetail } from './CapsuleDetail';
import { CAPSULE_ROW_GRID, type CapsuleBrowserRow } from './capsuleBrowserRows';

/** Free shows its own last runs read-only; browsing every capsule is the Pro part. */
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
  const samples = runs.slice(0, FREE_TIER_LIMITS.recentRuns);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = samples[selectedIndex] ?? samples[0];
  // Labs › Pro in context: a PRO chip to Compare plans instead of the upgrade button.
  const inContext = useTeachingPaywall();

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
      footerLegend={
        inContext ? (
          <span className="text-caption text-fg-muted" data-testid="capsule-list-free-slice">
            <ProChip>{t('capsuleList.gate.proSlice')}</ProChip>
          </span>
        ) : (
          <span className="text-caption text-fg-muted">{t('capsuleList.gate.pro')}</span>
        )
      }
      trailing={
        inContext ? null : (
          <button type="button" onClick={onUpgrade} data-testid="capsule-list-upsell-cta" className="button-primary">
            {t('capsuleList.upsell.cta')}
          </button>
        )
      }
    >
      <div data-testid="capsule-list-upsell">
        {selected ? (
          <section aria-labelledby={`${titleId}-last`}>
            <h3 id={`${titleId}-last`} className="mb-2 font-mono text-eyebrow font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              {t('capsuleList.gate.lastRun')}
            </h3>
            <div className="mb-4 flex flex-col gap-1.5">
              {samples.map((row, index) => (
                <button
                  key={row.id}
                  type="button"
                  data-testid="capsule-list-row"
                  aria-pressed={row === selected}
                  onClick={() => setSelectedIndex(index)}
                  className={`${CAPSULE_ROW_GRID} focus-ring h-[44px] w-full rounded-lg border border-border-subtle px-3 text-left ${row === selected ? 'bg-accent-tint' : 'hover:bg-bg-panel-alt'}`}
                >
                  <CapsuleRowCells row={row} now={now} />
                </button>
              ))}
            </div>
            <CapsuleDetail capsule={selected.capsule} />
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

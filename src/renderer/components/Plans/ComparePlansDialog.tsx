import { Check, Minus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FREE_TIER_LIMITS } from '../../../shared/entitlements';
import { PLAN_ROWS, TRIAL_DAYS, type PlanRow, type PlanValue } from '../../../shared/plans';
import type { Language } from '../../types/language';
import { useTrialStatus } from '../../hooks/useTrialStatus';
import { useEffectiveTier } from '../../hooks/useEntitlement';
import { emitCommand } from '../../stores/commandBus';
import { languageLabel } from '../../utils/languageMeta';
import { openPricingPage } from '../../utils/openPricingPage';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';

function PlanCell({ value, unit }: { value: PlanValue; unit: PlanRow['unit'] }) {
  const { t, i18n } = useTranslation();
  if (value === true) return <Check size={14} aria-label={t('plans.included')} className="text-success-fg" />;
  if (value === false) return <Minus size={14} aria-label={t('plans.notIncluded')} className="text-fg-subtle" />;
  if (typeof value === 'number') {
    const formatted = value.toLocaleString(i18n.language);
    return <span>{unit === 'steps' ? t('plans.steps', { count: value, formatted }) : formatted}</span>;
  }
  if (value === 'freeLanguages') return <span>{FREE_TIER_LIMITS.allowedLanguages.map(language => languageLabel(language as Language)).join(', ')}</span>;
  return <span>{t(`plans.value.${value}`)}</span>;
}

/** The single Free against Pro table every PRO chip opens, with the trial on top. */
export function ComparePlansDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const tier = useEffectiveTier();
  const trial = useTrialStatus();
  const paid = tier !== 'free';

  const openAccount = () => {
    onClose();
    emitCommand('settings.openLicense');
  };

  return (
    <ModalShell
      onClose={onClose}
      scrim="veil"
      size="max-w-[640px]"
      labelledById="compare-plans-title"
      headerClose="button"
      closeLabel={t('plans.close')}
      footer={false}
      bodyMaxHeightClassName="max-h-[min(80vh,720px)]"
      header={
        <h2 id="compare-plans-title" className="text-body font-semibold text-fg-base">
          {t('plans.title')}
        </h2>
      }
    >
      <div className="space-y-3 p-4" data-testid="compare-plans">
        {trial ? (
          <p className="rounded-lg border border-accent bg-accent/10 px-3 py-2 text-body-sm text-fg-base" data-testid="compare-plans-trial">
            {trial.ended ? t('plans.trialEnded') : t('plans.trialLeft', { count: trial.daysLeft, total: trial.totalDays })}
          </p>
        ) : !paid ? (
          <div className="flex items-center gap-3 rounded-lg border border-accent bg-accent/10 px-3 py-2" data-testid="compare-plans-trial">
            <Sparkles size={14} aria-hidden="true" className="shrink-0 text-accent-fg" />
            <span className="min-w-0 flex-1 text-body-sm text-fg-base">{t('plans.tryPro', { count: TRIAL_DAYS })}</span>
            <button type="button" onClick={openAccount} data-testid="compare-plans-start-trial" className="button-primary h-7 shrink-0 px-2.5 text-caption">
              {t('plans.startTrial')}
            </button>
          </div>
        ) : null}

        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="text-left font-mono text-micro uppercase tracking-[0.16em] text-fg-subtle">
              <th scope="col" className="py-1.5 font-semibold">
                <span className="sr-only">{t('plans.feature')}</span>
              </th>
              {(['free', 'pro'] as const).map(plan => (
                <th key={plan} scope="col" className={cn('py-1.5 font-semibold', plan === 'free' ? 'w-48' : 'w-32', (plan === 'pro') === paid && 'text-accent-fg')}>
                  {t(`plans.column.${plan}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_ROWS.map(row => (
              <tr key={row.id} className="border-t border-border-subtle" data-testid={`compare-plans-row-${row.id}`}>
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-base">
                  {t(`plans.row.${row.id}`)}
                </th>
                <td className="py-1.5 pr-3 text-fg-muted">
                  <PlanCell value={row.free} unit={row.unit} />
                </td>
                <td className="py-1.5 text-fg-base">
                  <PlanCell value={row.pro} unit={row.unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
          <button type="button" onClick={() => void openPricingPage(i18n.language)} data-testid="compare-plans-pricing" className="button-secondary h-7 px-2.5 text-caption">
            {t('plans.pricing')}
          </button>
          <button type="button" onClick={openAccount} data-testid="compare-plans-license" className="button-secondary h-7 px-2.5 text-caption">
            {t('plans.applyLicense')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

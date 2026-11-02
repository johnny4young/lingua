import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { emitCommand } from '../../stores/commandBus';
import { useSettingsStore } from '../../stores/settingsStore';

const CHIP = 'rounded border border-warning-border bg-warning-bg px-1 font-mono text-micro font-bold text-warning-fg';

/** The PRO mark beside a limited feature; with Labs › Pro in context it opens Compare plans. */
export function ProChip({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const linked = useSettingsStore(state => state.featureFlags.teachingPaywall === true);
  const chip = <span className={CHIP}>{t('actionPill.badgePro')}</span>;
  if (!linked) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {chip}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => emitCommand('plans.compare')}
      data-testid="pro-chip"
      className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-left hover:text-fg-base"
    >
      {chip}
      {children}
    </button>
  );
}

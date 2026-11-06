import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { emitCommand } from '../../stores/commandBus';

const CHIP = 'rounded border border-warning-border bg-warning-bg px-1 font-mono text-micro font-bold text-warning-fg';

/** The PRO mark beside a limited feature; it opens Compare plans. */
export function ProChip({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const chip = <span className={CHIP}>{t('actionPill.badgePro')}</span>;
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

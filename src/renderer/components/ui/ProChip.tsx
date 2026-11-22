import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { emitCommand } from '../../stores/commandBus';

const CHIP = 'rounded border border-warning-border bg-warning-bg px-1 font-mono text-micro font-bold text-warning-fg';

/** The bare PRO mark, for a control that already opens Compare plans itself. */
export function ProMark() {
  const { t } = useTranslation();
  return <span className={CHIP}>{t('actionPill.badgePro')}</span>;
}

/** The PRO mark beside a limited feature; it opens Compare plans. */
export function ProChip({ children }: { children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => emitCommand('plans.compare')}
      data-testid="pro-chip"
      className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-left hover:text-fg-base"
    >
      <ProMark />
      {children}
    </button>
  );
}

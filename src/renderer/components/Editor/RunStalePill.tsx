import { useTranslation } from 'react-i18next';
import { useRunStale } from '../../hooks/useRunStale';
import { StatusBadge } from '../ui/StatusBadge';

/** Shown while the visible results come from older code than the editor holds. */
export function RunStalePill() {
  const { t } = useTranslation();
  const { stale } = useRunStale();
  if (!stale) return null;
  return (
    <span title={t('runState.stale.hint')} data-testid="run-stale-pill">
      <StatusBadge tone="warning" dot>
        {t('runState.stale.label')}
      </StatusBadge>
      <span className="sr-only">{t('runState.stale.hint')}</span>
    </span>
  );
}

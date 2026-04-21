import { useTranslation } from 'react-i18next';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { trackEvent } from '../../utils/telemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { Row, Section } from './shared';

/**
 * RL-028 second slice — Settings row that surfaces the in-memory
 * execution history counter and a Clear button.
 *
 * The store itself is intentionally never persisted across reloads
 * (privacy posture documented in executionHistoryStore.ts). This row
 * lets the user wipe the buffer manually without reloading. A richer
 * "Recent runs" table comes in a follow-up slice; keeping this minimal
 * avoids committing to a specific UX before the surface has shipped.
 */
export function ExecutionHistorySection() {
  const { t } = useTranslation();
  const effectiveTier = useEffectiveTier();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const entryCount = useExecutionHistoryStore((state) => state.entries.length);
  const clear = useExecutionHistoryStore((state) => state.clear);

  const handleUnlock = () => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.executionHistory'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'execution-history',
      tier: effectiveTier,
    });
  };

  return (
    <Section
      id="execution-history"
      title={t('executionHistory.title')}
      description={t('executionHistory.description')}
    >
      <Row
        label={
          canUseExecutionHistory
            ? t('executionHistory.countLabel', { count: entryCount })
            : t('executionHistory.lockedLabel')
        }
        hint={
          canUseExecutionHistory
            ? t('executionHistory.privacyNote')
            : t('executionHistory.lockedHint')
        }
      >
        {canUseExecutionHistory ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => clear()}
            disabled={entryCount === 0}
            data-testid="execution-history-clear"
            aria-label={t('executionHistory.clearButton')}
          >
            {t('executionHistory.clearButton')}
          </button>
        ) : (
          <button
            type="button"
            className="button-secondary"
            onClick={handleUnlock}
            data-testid="execution-history-unlock"
            aria-label={t('executionHistory.unlockButton')}
          >
            {t('executionHistory.unlockButton')}
          </button>
        )}
      </Row>
    </Section>
  );
}

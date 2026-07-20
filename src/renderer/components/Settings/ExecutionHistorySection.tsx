import { useTranslation } from 'react-i18next';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { trackEvent } from '../../utils/telemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { SpecCard, SpecRow, SettingsSection } from '../ui/SpecRow';

/**
 * implementation — Settings row that surfaces the in-memory
 * execution history counter and a Clear button.
 *
 * The store itself is intentionally never persisted across reloads
 * (privacy posture documented in executionHistoryStore.ts). This row
 * lets the user wipe the buffer manually without reloading. A richer
 * "Recent runs" table comes in a follow-up work; keeping this minimal
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
    // `id` preserved as a scroll/anchor target; SettingsSection renders
    // its own <section>, so the wrapper carries the anchor.
    <div id="execution-history">
      <SettingsSection
        eyebrow={t('executionHistory.title')}
        description={t('executionHistory.description')}
      >
        <SpecCard>
          <SpecRow
            label={
              canUseExecutionHistory
                ? t('executionHistory.countLabel', { count: entryCount })
                : t('executionHistory.lockedLabel')
            }
            description={
              canUseExecutionHistory
                ? t('executionHistory.privacyNote')
                : t('executionHistory.lockedHint')
            }
            last
            control={
              canUseExecutionHistory ? (
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
              )
            }
          />
        </SpecCard>
      </SettingsSection>
    </div>
  );
}

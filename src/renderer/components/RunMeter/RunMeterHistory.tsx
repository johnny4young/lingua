import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useRunner } from '../../hooks/useRunner';
import { useTelemetry } from '../../hooks/useTelemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { replayHistoryEntry } from '../../utils/replayHistoryEntry';
import { ExecutionComparisonModal } from '../Console/ExecutionComparisonModal';
import { ExecutionHistoryPopover } from '../Console/ExecutionHistoryPopover';

/** The session's execution history, opened from the meter's run count. Memoized: the meter ticks while a run goes. */
export const RunMeterHistory = memo(function RunMeterHistory({ label }: { label: string }) {
  const { t } = useTranslation();
  const { track } = useTelemetry();
  const { run, isRunning } = useRunner();
  const effectiveTier = useEffectiveTier();
  const entitled = useEntitlement('EXECUTION_HISTORY');
  const [comparison, setComparison] = useState<[ExecutionHistoryEntry, ExecutionHistoryEntry] | null>(null);

  const handleRerun = useCallback(
    (entry: ExecutionHistoryEntry) => {
      // Telemetry only on an actual dispatch; a run already in flight short-circuits.
      if (replayHistoryEntry(entry, { isRunning, run })) {
        track('runtime.history_replay', { language: entry.language, status: entry.status, surface: 'popover' });
      }
    },
    [isRunning, run, track]
  );

  const handleBlocked = useCallback(() => {
    pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel: t('upsell.feature.executionHistory') });
    track('feature.blocked', { entitlement: 'execution-history', tier: effectiveTier });
  }, [effectiveTier, t, track]);

  return (
    <>
      <ExecutionHistoryPopover
        triggerLabel={label}
        defaultThisTabOnly
        enabled={entitled}
        onBlocked={handleBlocked}
        onRerun={handleRerun}
        onCompare={entitled ? (older, newer) => setComparison([older, newer]) : undefined}
      />
      <ExecutionComparisonModal entries={comparison} onClose={() => setComparison(null)} />
    </>
  );
});

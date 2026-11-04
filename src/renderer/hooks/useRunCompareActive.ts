import { useSettingsStore } from '../stores/settingsStore';
import { useEntitlement } from './useEntitlement';

/** The Compare tab lists every run where the tier keeps run history and code capture is on. */
export function useRunCompareActive(): boolean {
  const entitled = useEntitlement('EXECUTION_HISTORY');
  const captureOn = useSettingsStore((state) => state.executionHistorySnapshotEnabled);
  return entitled && captureOn;
}

import { useEntitlement } from './useEntitlement';
import { useSettingsStore } from '../stores/settingsStore';

/** The Compare tab lists every run: its Labs flag is on and the tier keeps run history. */
export function useRunCompareActive(): boolean {
  const flagOn = useSettingsStore(state => state.featureFlags.runCompare === true);
  const entitled = useEntitlement('EXECUTION_HISTORY');
  return flagOn && entitled;
}

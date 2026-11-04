import { useEntitlement } from './useEntitlement';

/** The Compare tab lists every run where the tier keeps run history. */
export function useRunCompareActive(): boolean {
  return useEntitlement('EXECUTION_HISTORY');
}

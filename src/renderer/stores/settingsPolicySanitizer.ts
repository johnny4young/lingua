import type { SettingsState } from '../types/settings';
import { sanitizeNetworkPolicy } from '../../shared/networkPolicy';
import { sanitizeRunPolicyByGroup } from '../../shared/runPolicy';

/** The network policy and the run policy. */
export function sanitizePolicySettings(
  persisted: Partial<SettingsState>
): Pick<SettingsState, 'networkFromRunningCode' | 'runPolicyByGroup'> {
  return {
    networkFromRunningCode: sanitizeNetworkPolicy(persisted.networkFromRunningCode),
    runPolicyByGroup: sanitizeRunPolicyByGroup(persisted.runPolicyByGroup),
  };
}

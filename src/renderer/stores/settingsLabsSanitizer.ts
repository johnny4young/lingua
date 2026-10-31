import type { SettingsState } from '../types/settings';
import { sanitizeFeatureFlags } from '../../shared/featureFlags';
import { sanitizeNetworkPolicy } from '../../shared/networkPolicy';
import { sanitizeRunPolicyByGroup } from '../../shared/runPolicy';

/** The Labs flags and the settings they gate: the network policy and the run policy. */
export function sanitizeLabsSettings(
  persisted: Partial<SettingsState>
): Pick<SettingsState, 'featureFlags' | 'networkFromRunningCode' | 'runPolicyByGroup'> {
  return {
    featureFlags: sanitizeFeatureFlags(persisted.featureFlags),
    networkFromRunningCode: sanitizeNetworkPolicy(persisted.networkFromRunningCode),
    runPolicyByGroup: sanitizeRunPolicyByGroup(persisted.runPolicyByGroup),
  };
}

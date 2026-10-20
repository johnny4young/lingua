import type { SettingsState } from '../types/settings';
import { sanitizeFeatureFlags } from '../../shared/featureFlags';
import { sanitizeNetworkPolicy } from '../../shared/networkPolicy';

/** The Labs flags and the network policy they gate. */
export function sanitizeLabsSettings(
  persisted: Partial<SettingsState>
): Pick<SettingsState, 'featureFlags' | 'networkFromRunningCode'> {
  return {
    featureFlags: sanitizeFeatureFlags(persisted.featureFlags),
    networkFromRunningCode: sanitizeNetworkPolicy(persisted.networkFromRunningCode),
  };
}

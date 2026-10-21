import i18next from 'i18next';
import { withinTabBudget } from '../../../shared/entitlements';
import { useEditorStore } from '../../stores/editorStore';
import { budgetedTabCount } from '../../stores/editorTabUtils';
import { currentEffectiveTier } from '../../stores/licenseSelectors';
import { sqlQueryTabCount } from '../../stores/sqlQueryTabCount';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import type { TelemetryTrack } from '../../hooks/useTelemetry';

/** True when one more SQL query tab fits the Free budget; otherwise shows the upsell. */
export function admitSqlQueryTab(track: TelemetryTrack): boolean {
  const documents = budgetedTabCount(useEditorStore.getState().tabs.filter((tab) => tab.kind !== 'sql'));
  const tier = currentEffectiveTier();
  if (withinTabBudget(tier, documents + sqlQueryTabCount() + 1)) return true;
  pushUpsellNotice({
    messageKey: 'upsell.freeCeilingReached',
    featureLabel: i18next.t('upsell.feature.extraTabs'),
  });
  track('feature.blocked', { entitlement: 'tabs', tier });
  return false;
}

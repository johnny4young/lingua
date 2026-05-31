import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';
import { trackEvent } from '../../utils/telemetry';
import { Toggle } from './shared';
import { SpecCard, SpecRow, SettingsSection } from '../ui/SpecRow';

/**
 * RL-069 Slice 3 — Developer Utilities settings.
 *
 * Houses two surfaces:
 *   1. Clipboard-on-focus consent toggle. The state machine matches
 *      RL-065 telemetry: `unset` → `granted`/`declined`, never back.
 *      Default off; the user has to flip it on to opt in.
 *   2. "Clear all utility history" — bulk affordance for users who
 *      enabled per-tool persistence and want to wipe everything in a
 *      single click. Surfaced here in addition to per-tool drawers
 *      so a privacy-conscious user has a single canonical clear.
 */
export function UtilitiesSection() {
  const { t } = useTranslation();
  const consent = useSettingsStore(
    (state) => state.utilitiesClipboardOnFocusConsent
  );
  const setConsent = useSettingsStore(
    (state) => state.setUtilitiesClipboardOnFocusConsent
  );
  const clearAllHistory = useUtilityHistoryStore((state) => state.clearHistory);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const consentStatusKey =
    consent === 'granted'
      ? 'utilities.settings.clipboardOnFocus.granted'
      : consent === 'declined'
        ? 'utilities.settings.clipboardOnFocus.declined'
        : 'utilities.settings.clipboardOnFocus.notSet';

  const handleClearAll = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clearAllHistory();
    void trackEvent('utility.history.cleared', {
      utilityId: 'all',
      scope: 'all',
    });
    setConfirmingClear(false);
  };

  return (
    <SettingsSection
      eyebrow={t('utilities.settings.title')}
      description={t('utilities.settings.description')}
    >
      <SpecCard>
        <SpecRow
          label={t('utilities.settings.clipboardOnFocus.label')}
          description={t('utilities.settings.clipboardOnFocus.hint')}
          control={
            <div className="grid justify-items-end gap-1">
              <Toggle
                value={consent === 'granted'}
                onChange={() =>
                  setConsent(consent === 'granted' ? 'declined' : 'granted')
                }
                aria-label={t('utilities.settings.clipboardOnFocus.label')}
              />
              <span
                data-testid="utilities-clipboard-on-focus-status"
                role="status"
                aria-live="polite"
                className="text-xs text-fg-subtle"
              >
                {t(consentStatusKey)}
              </span>
            </div>
          }
        />
        <SpecRow
          label={t('utilities.settings.clearAll.label')}
          description={t('utilities.settings.clearAll.hint')}
          last
          control={
            <div className="grid justify-items-end gap-1">
              <button
                type="button"
                data-testid="utilities-clear-all-history"
                onClick={handleClearAll}
                className="button-secondary"
              >
                {confirmingClear
                  ? t('utilities.settings.clearAll.confirm')
                  : t('utilities.settings.clearAll.label')}
              </button>
              {confirmingClear ? (
                <button
                  type="button"
                  data-testid="utilities-clear-all-history-cancel"
                  onClick={() => setConfirmingClear(false)}
                  className="text-xs text-fg-subtle underline-offset-2 hover:text-fg-base hover:underline"
                >
                  {t('utilities.settings.clearAll.cancel')}
                </button>
              ) : null}
            </div>
          }
        />
      </SpecCard>
    </SettingsSection>
  );
}

import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { Row, Section, Toggle } from './shared';

/**
 * Privacy section — owns the RL-065 telemetry consent toggle. Three-state
 * consent: `unset` (default, treated as opt-out), `granted`, `declined`.
 * Flipping the toggle moves between `granted` and `declined`; we never
 * revert to `unset` from the UI so the future first-run prompt stays
 * one-shot per install.
 */
export function PrivacySection() {
  const { t } = useTranslation();
  const telemetryConsent = useSettingsStore((state) => state.telemetryConsent);
  const setTelemetryConsent = useSettingsStore((state) => state.setTelemetryConsent);

  const statusKey =
    telemetryConsent === 'granted'
      ? 'privacy.telemetry.granted'
      : telemetryConsent === 'declined'
        ? 'privacy.telemetry.declined'
        : 'privacy.telemetry.notSet';

  return (
    <Section
      title={t('privacy.title')}
      description={t('privacy.description')}
    >
      <Row
        label={t('privacy.telemetry.label')}
        hint={t('privacy.telemetry.hint')}
      >
        <div className="grid w-full gap-1 text-right">
          <Toggle
            value={telemetryConsent === 'granted'}
            onChange={() =>
              setTelemetryConsent(telemetryConsent === 'granted' ? 'declined' : 'granted')
            }
          />
          <span
            data-testid="telemetry-status"
            role="status"
            aria-live="polite"
            className="text-xs text-muted"
          >
            {t(statusKey)}
          </span>
        </div>
      </Row>
    </Section>
  );
}

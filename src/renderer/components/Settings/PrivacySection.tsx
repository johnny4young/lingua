import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { Row, Section, Toggle } from './shared';

/**
 * Privacy section — owns the RL-065 telemetry consent toggle and the
 * RL-079 native-execution acknowledgement reset. Three-state telemetry
 * consent: `unset` (default, treated as opt-out), `granted`, `declined`.
 * Flipping the toggle moves between `granted` and `declined`; we never
 * revert to `unset` from the UI so the future first-run prompt stays
 * one-shot per install. Native execution acknowledgement is binary —
 * the modal flips it once, and this surface lets the user reset it
 * back so the warning re-appears on the next Go/Rust run.
 */
export function PrivacySection() {
  const { t } = useTranslation();
  const telemetryConsent = useSettingsStore((state) => state.telemetryConsent);
  const setTelemetryConsent = useSettingsStore((state) => state.setTelemetryConsent);
  const nativeExecutionAcknowledged = useSettingsStore(
    (state) => state.nativeExecutionAcknowledged
  );
  const setNativeExecutionAcknowledged = useSettingsStore(
    (state) => state.setNativeExecutionAcknowledged
  );

  const statusKey =
    telemetryConsent === 'granted'
      ? 'privacy.telemetry.granted'
      : telemetryConsent === 'declined'
        ? 'privacy.telemetry.declined'
        : 'privacy.telemetry.notSet';

  const nativeStatusKey = nativeExecutionAcknowledged
    ? 'settings.nativeExecution.acknowledged'
    : 'settings.nativeExecution.notAcknowledged';

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
      <Row
        label={t('settings.nativeExecution.title')}
        hint={t('settings.nativeExecution.description')}
      >
        <div className="grid w-full gap-1 text-right">
          <button
            type="button"
            className="button-secondary justify-self-end"
            onClick={() => setNativeExecutionAcknowledged(false)}
            disabled={!nativeExecutionAcknowledged}
            data-testid="native-execution-reset"
          >
            {t('settings.nativeExecution.reset')}
          </button>
          <span
            data-testid="native-execution-status"
            role="status"
            aria-live="polite"
            className="text-xs text-muted"
          >
            {t(nativeStatusKey)}
          </span>
        </div>
      </Row>
    </Section>
  );
}

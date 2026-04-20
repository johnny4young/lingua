import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';
import { OverlayBackdrop, OverlayCard } from './ui/chrome';

/**
 * RL-065 first-run telemetry consent prompt.
 *
 * Mounts once on boot when `telemetryConsent === 'unset'` AND the renderer
 * is running inside the desktop shell (the consent IPC bridge is present).
 * The web build intentionally never renders this — there is no telemetry
 * on web, so asking would be misleading.
 *
 * Allow → flips `telemetryConsent` to `granted` and mirrors to main via
 * the existing `consent:set` IPC (the settings store's `setTelemetryConsent`
 * already handles the mirror).
 * Decline → flips to `declined`, same mirror path.
 * Either choice removes the `unset` gate so this modal never reappears.
 */
export function FirstRunConsentModal() {
  const { t } = useTranslation();
  const telemetryConsent = useSettingsStore((state) => state.telemetryConsent);
  const setTelemetryConsent = useSettingsStore((state) => state.setTelemetryConsent);

  const isDesktop =
    typeof window !== 'undefined' &&
    Boolean(window.lingua) &&
    window.lingua.platform !== 'web';
  if (!isDesktop) return null;
  if (telemetryConsent !== 'unset') return null;

  return (
    <OverlayBackdrop>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-consent-title"
        className="w-[min(92vw,520px)] max-w-none"
        data-testid="first-run-consent-modal"
      >
        <div className="surface-header px-5 py-4">
          <h2
            id="first-run-consent-title"
            className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground"
          >
            {t('privacy.firstRun.title')}
          </h2>
        </div>
        <div className="space-y-4 px-5 py-5 text-sm leading-6 text-muted">
          <p>{t('privacy.firstRun.body')}</p>
          <p className="text-xs text-muted/80">
            {t('privacy.firstRun.changeLater')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-border/80">
          <button
            type="button"
            className="button-secondary"
            onClick={() => setTelemetryConsent('declined')}
            data-testid="first-run-consent-decline"
          >
            {t('privacy.firstRun.decline')}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => setTelemetryConsent('granted')}
            data-testid="first-run-consent-allow"
          >
            {t('privacy.firstRun.allow')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore, type LicenseStatus } from '../../stores/licenseStore';
import { useUIStore } from '../../stores/uiStore';
import { Row, Section } from './shared';

/**
 * License paste / clear surface for RL-059. Intentionally minimal — the
 * verifier + store already own the state machine; this component just
 * gives users a way to hand a token over and read the result back.
 *
 * Errors from `setLicenseToken` surface through the shared status
 * notice so the copy stays consistent with the rest of Settings.
 */

function statusToneClass(status: LicenseStatus): string {
  switch (status.kind) {
    case 'active':
      return 'border-success/60 bg-success/10 text-success';
    case 'grace':
      return 'border-warning/60 bg-warning/10 text-warning';
    case 'invalid':
      return 'border-danger/60 bg-danger/10 text-danger';
    case 'verifying':
      return 'border-border/80 bg-surface-strong/85 text-muted';
    case 'free':
    default:
      return 'border-border/80 bg-surface-strong/85 text-foreground';
  }
}

function statusLabelKey(status: LicenseStatus): string {
  switch (status.kind) {
    case 'active':
      return 'license.status.active';
    case 'grace':
      return 'license.status.grace';
    case 'invalid':
      return 'license.status.invalid';
    case 'verifying':
      return 'license.status.verifying';
    case 'free':
    default:
      return 'license.status.free';
  }
}

/**
 * Map an invalid-status `reason` code to a user-facing i18n key. The raw
 * `status.message` string is developer-only — it can mention env vars,
 * JWK fields, or clock skew internals that would leak implementation
 * details into end-user UI. Keep the mapping here so every reason we emit
 * from the verifier has to land on a translated string deliberately.
 */
function invalidReasonMessageKey(status: Extract<LicenseStatus, { kind: 'invalid' }>): string {
  switch (status.reason) {
    case 'malformed':
      return 'license.notice.invalid.malformed';
    case 'invalid-signature':
      return 'license.notice.invalid.signature';
    case 'expired':
      return 'license.notice.invalid.expired';
    case 'clock-skew':
      return 'license.notice.invalid.clockSkew';
    case 'unsupported-tier':
      return 'license.notice.invalid.unsupportedTier';
    case 'no-public-key':
      return 'license.notice.invalid.notAccepted';
    // RL-061 Slice 2.5 — server-rejection reasons. Slice 3 will surface
    // the device-management modal that lets the user remediate the
    // `devices-exhausted` case without re-pasting the token.
    case 'devices-exhausted':
      return 'license.notice.invalid.devicesExhausted';
    case 'license-refunded':
      return 'license.notice.invalid.refunded';
    case 'unknown-license':
      return 'license.notice.invalid.unknownLicense';
    default:
      // Fall back to the generic copy so a new reason code doesn't crash
      // the UI before its i18n key lands.
      return 'license.notice.invalid';
  }
}

function tierLabel(t: ReturnType<typeof useTranslation>['t'], status: LicenseStatus): string {
  if (status.kind === 'active' || status.kind === 'grace') {
    return t(`license.tier.${status.verification.payload.tier}`);
  }
  return t('license.tier.free');
}

export function LicenseSection() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const status = useLicenseStore(state => state.status);
  const token = useLicenseStore(state => state.token);
  const setLicenseToken = useLicenseStore(state => state.setLicenseToken);
  const clearLicense = useLicenseStore(state => state.clearLicense);
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);

  const handleApply = async () => {
    if (isApplying) return;
    setIsApplying(true);
    try {
      const next = await setLicenseToken(draft);
      if (next.kind === 'invalid') {
        pushStatusNotice({
          tone: 'error',
          messageKey: invalidReasonMessageKey(next),
          // Deliberately omit `next.message` — it contains developer-only
          // detail (env var names, verifier internals) that has no place
          // in the end-user banner. Reason-specific copy lives in i18n.
        });
        return;
      }
      setDraft('');
      if (next.kind === 'active' || next.kind === 'grace') {
        // Read the post-apply `serverSync` flag to decide between the
        // standard activation notice and the offline-grace warning.
        // Pulled here (not via a selector subscription) so the component
        // doesn't re-render on every apply just to read this once.
        const serverSync = useLicenseStore.getState().serverSync;
        if (serverSync === 'unreachable') {
          // 24-hour offline-grace per LICENSING_ADR Decision 4 — the
          // license is locally valid but the server didn't see this
          // device yet. Surface it so the user knows to try again with
          // network reachable.
          pushStatusNotice({
            tone: 'info',
            messageKey: 'license.notice.serverUnreachable',
            values: { tier: tierLabel(t, next) },
          });
        } else {
          pushStatusNotice({
            tone: 'success',
            messageKey: 'license.notice.activated',
            values: { tier: tierLabel(t, next) },
          });
        }
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleClear = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      const next = await clearLicense();
      if (next.kind === 'invalid') {
        pushStatusNotice({ tone: 'error', messageKey: 'license.notice.clearFailed' });
        return;
      }
      setDraft('');
      pushStatusNotice({ tone: 'info', messageKey: 'license.notice.cleared' });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Section title={t('license.title')} description={t('license.description')}>
      <Row label={t('license.current.label')} hint={t('license.current.hint')}>
        <div className="grid w-full gap-2 text-right">
          <span
            data-testid="license-status-pill"
            aria-live="polite"
            className={`inline-flex w-fit items-center gap-2 self-end rounded-[0.8rem] border px-2 py-1 text-xs font-medium ${statusToneClass(status)}`}
          >
            {t(statusLabelKey(status), { tier: tierLabel(t, status) })}
          </span>
          {token ? (
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={isClearing || isApplying}
              className="self-end rounded-[0.65rem] border border-border/70 px-2 py-0.5 text-[11px] text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="license-clear"
            >
              {t('license.clear')}
            </button>
          ) : null}
        </div>
      </Row>

      <Row label={t('license.paste.label')} hint={t('license.paste.hint')}>
        <div className="grid w-full gap-2">
          <textarea
            aria-label={t('license.paste.label')}
            placeholder={t('license.paste.placeholder')}
            value={draft}
            spellCheck={false}
            onChange={event => setDraft(event.target.value)}
            data-testid="license-input"
            className="min-h-20 w-full rounded-[1rem] border border-border/80 bg-background/88 px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={isApplying || isClearing || draft.trim().length === 0}
            data-testid="license-apply"
            className="button-primary w-fit self-end disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isApplying ? t('license.applying') : t('license.apply')}
          </button>
        </div>
      </Row>
    </Section>
  );
}

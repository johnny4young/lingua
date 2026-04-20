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
    case 'free':
    default:
      return 'license.status.free';
  }
}

export function LicenseSection() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  const status = useLicenseStore((state) => state.status);
  const token = useLicenseStore((state) => state.token);
  const setLicenseToken = useLicenseStore((state) => state.setLicenseToken);
  const clearLicense = useLicenseStore((state) => state.clearLicense);
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);

  const handleApply = async () => {
    if (isApplying) return;
    setIsApplying(true);
    try {
      const next = await setLicenseToken(draft);
      if (next.kind === 'invalid') {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'license.notice.invalid',
          detail: next.message,
        });
        return;
      }
      setDraft('');
      if (next.kind === 'active' || next.kind === 'grace') {
        pushStatusNotice({
          tone: 'success',
          messageKey: 'license.notice.activated',
          values: { tier: next.verification.payload.tier },
        });
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleClear = () => {
    clearLicense();
    setDraft('');
    pushStatusNotice({ tone: 'info', messageKey: 'license.notice.cleared' });
  };

  const tierLabel =
    status.kind === 'active' || status.kind === 'grace'
      ? status.verification.payload.tier
      : 'free';

  return (
    <Section title={t('license.title')} description={t('license.description')}>
      <Row label={t('license.current.label')} hint={t('license.current.hint')}>
        <div className="grid w-full gap-2 text-right">
          <span
            data-testid="license-status-pill"
            aria-live="polite"
            className={`inline-flex w-fit items-center gap-2 self-end rounded-[0.8rem] border px-2 py-1 text-xs font-medium ${statusToneClass(status)}`}
          >
            {t(statusLabelKey(status), { tier: tierLabel })}
          </span>
          {token ? (
            <button
              type="button"
              onClick={handleClear}
              className="self-end rounded-[0.65rem] border border-border/70 px-2 py-0.5 text-[11px] text-muted hover:text-foreground"
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
            onChange={(event) => setDraft(event.target.value)}
            data-testid="license-input"
            className="min-h-20 w-full rounded-[1rem] border border-border/80 bg-background/88 px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={isApplying || draft.trim().length === 0}
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

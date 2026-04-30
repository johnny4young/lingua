import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { startRecovery } from '../../services/recoveryServer';
import { Row } from './shared';

/**
 * RL-061 Slice 4 — License recovery magic-link start CTA.
 *
 * Two visual states:
 *
 *   1. Form: email input + Resend button.
 *   2. After a successful POST /licenses/recover/start: "check your
 *      email" success state.
 *
 * No-info-leak: the worker ALWAYS responds 200 + neutral copy
 * regardless of whether the email matches a license, so the
 * renderer must use the same notice for every successful response.
 *
 * `prefilledEmail` lets parents (LicenseSection's recover-hint
 * branch, EducationCta's duplicate-email branch) pre-populate the
 * input so the user clicks Resend without retyping.
 */
export function RecoveryCta({ prefilledEmail }: { prefilledEmail?: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(prefilledEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [resendSentTo, setResendSentTo] = useState<string | null>(null);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  // Sync input when the parent passes a new prefilled value (e.g. user
  // hits the duplicate-email recover affordance for a different email).
  useEffect(() => {
    if (prefilledEmail && prefilledEmail !== email && !resendSentTo) {
      setEmail(prefilledEmail);
    }
    // Intentionally narrow deps: re-syncing when `email` changes would
    // fight the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledEmail]);

  const handleResend = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const result = await startRecovery({ email: trimmed });
      if (result.ok) {
        setResendSentTo(trimmed);
        pushStatusNotice({
          tone: 'info',
          messageKey: 'license.recovery.notice.sent',
        });
        return;
      }

      switch (result.reason) {
        case 'invalid-input':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.recovery.notice.invalidEmail',
          });
          return;
        case 'disabled':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.recovery.notice.disabled',
          });
          return;
        case 'unreachable':
        case 'server-error':
        default:
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.recovery.notice.unreachable',
          });
          return;
      }
    } finally {
      setBusy(false);
    }
  };

  if (resendSentTo) {
    return (
      <Row
        label={t('license.recovery.confirmingTitle')}
        hint={t('license.recovery.confirmingBody', { email: resendSentTo })}
      >
        <button
          type="button"
          onClick={() => {
            setResendSentTo(null);
            setEmail('');
          }}
          data-testid="recovery-restart"
          className="button-secondary w-fit self-end"
        >
          {t('license.recovery.restart')}
        </button>
      </Row>
    );
  }

  return (
    <Row label={t('license.recovery.title')} hint={t('license.recovery.body')}>
      <div className="grid w-full gap-2">
        <input
          type="email"
          aria-label={t('license.recovery.emailLabel')}
          placeholder={t('license.recovery.emailPlaceholder')}
          value={email}
          spellCheck={false}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          data-testid="recovery-email-input"
          className="w-full rounded-[1rem] border border-border/80 bg-background/88 px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
        />
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={busy || email.trim().length === 0}
          data-testid="recovery-start"
          className="button-primary w-fit self-end disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t('license.recovery.starting') : t('license.recovery.startCta')}
        </button>
      </div>
    </Row>
  );
}

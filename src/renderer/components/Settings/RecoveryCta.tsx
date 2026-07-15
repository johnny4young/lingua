import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { startRecovery } from '../../services/recoveryServer';
import { SpecRow } from '../ui/SpecRow';

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
 * input so the user clicks Resend without retyping. Parent callers
 * key the component by the prefill value when they need a new value
 * to reset the local draft.
 */
export function RecoveryCta({
  prefilledEmail,
  last = false,
}: {
  prefilledEmail?: string;
  /** Drops the bottom hairline when this is the final row in its SpecCard. */
  last?: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(prefilledEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [resendSentTo, setResendSentTo] = useState<string | null>(null);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

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
        case 'unsupported-protocol':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.notice.invalid.unsupportedProtocol',
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
      <SpecRow
        last={last}
        label={t('license.recovery.confirmingTitle')}
        description={t('license.recovery.confirmingBody', { email: resendSentTo })}
        control={
          <button
            type="button"
            onClick={() => {
              setResendSentTo(null);
              setEmail('');
            }}
            data-testid="recovery-restart"
            className="button-secondary"
          >
            {t('license.recovery.restart')}
          </button>
        }
      />
    );
  }

  return (
    <SpecRow
      last={last}
      label={t('license.recovery.title')}
      description={t('license.recovery.body')}
      control={
        <div className="flex w-full max-w-[280px] flex-col items-end gap-2">
          <input
            type="email"
            aria-label={t('license.recovery.emailLabel')}
            placeholder={t('license.recovery.emailPlaceholder')}
            value={email}
            spellCheck={false}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            data-testid="recovery-email-input"
            className="w-full rounded-md border border-border-default bg-bg-base px-3 py-2 text-body-sm text-fg-base outline-none transition-colors placeholder:text-fg-subtle focus:border-accent/55"
          />
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={busy || email.trim().length === 0}
            data-testid="recovery-start"
            className="button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('license.recovery.starting') : t('license.recovery.startCta')}
          </button>
        </div>
      }
    />
  );
}

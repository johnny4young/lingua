import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { startEducation } from '../../services/educationServer';
import { getDeviceName, getOrMintDeviceId, getOs } from '../../services/deviceFingerprint';
import { isLikelyEmail } from '../../utils/email';
import { SpecRow } from '../ui/SpecRow';

/**
 * implementation — Education magic-link start CTA.
 *
 * Two visual states:
 *
 *   1. Form: email input + Start button.
 *   2. After a successful POST /education/start: "check your email"
 *      success state. Real token email arrives AFTER the user clicks
 *      the confirmation link in their inbox; the renderer never
 *      auto-pastes for education.
 *
 * Duplicate branch surfaces `education-unavailable` plus a
 * `canRecover: true` flag — we hand that off to the parent via
 * `onRequestRecovery` so the LicenseSection can pre-fill RecoveryCta
 * with this email and give the user a one-click recovery affordance.
 */
export function EducationCta({
  onRequestRecovery,
  last = false,
}: {
  onRequestRecovery?: (email: string) => void;
  /** Drops the bottom hairline when this is the final row in its SpecCard. */
  last?: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  // UX-audit tail — inline aria-invalid + error on a rejected
  // email, mirroring the implementation license-paste pattern (see TrialCta).
  const [emailError, setEmailError] = useState(false);
  const emailErrorId = useId();
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const handleStart = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (trimmed.length === 0) return;
    if (!isLikelyEmail(trimmed)) {
      setEmailError(true);
      return;
    }
    setBusy(true);
    try {
      const result = await startEducation({
        email: trimmed,
        deviceId: getOrMintDeviceId(),
        deviceName: getDeviceName(),
        os: getOs(),
      });
      if (result.ok) {
        setConfirmationSentTo(trimmed);
        pushStatusNotice({
          tone: 'info',
          messageKey: 'license.education.notice.confirmationSent',
        });
        return;
      }

      switch (result.reason) {
        case 'not-educational':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.notEducational',
          });
          return;
        case 'education-unavailable':
          pushStatusNotice({
            tone: 'info',
            messageKey: 'license.education.notice.unavailable',
          });
          if (result.canRecover && onRequestRecovery) {
            onRequestRecovery(trimmed);
          }
          return;
        case 'rate-limited':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.rateLimited',
          });
          return;
        case 'confirmation-email-failed':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.confirmationFailed',
          });
          return;
        case 'invalid-input':
          setEmailError(true);
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.invalidEmail',
          });
          return;
        case 'not-implemented':
        case 'disabled':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.disabled',
          });
          return;
        case 'unreachable':
        case 'server-error':
        default:
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.unreachable',
          });
          return;
      }
    } finally {
      setBusy(false);
    }
  };

  if (confirmationSentTo) {
    return (
      <SpecRow
        last={last}
        label={t('license.education.confirmingTitle')}
        description={t('license.education.confirmingBody', { email: confirmationSentTo })}
        control={
          <button
            type="button"
            onClick={() => {
              setConfirmationSentTo(null);
              setEmail('');
            }}
            data-testid="education-restart"
            className="button-secondary"
          >
            {t('license.education.restart')}
          </button>
        }
      />
    );
  }

  return (
    <SpecRow
      last={last}
      label={t('license.education.title')}
      description={t('license.education.body')}
      control={
        <div className="flex w-full max-w-[280px] flex-col items-end gap-2">
          <input
            type="email"
            aria-label={t('license.education.emailLabel')}
            placeholder={t('license.education.emailPlaceholder')}
            value={email}
            spellCheck={false}
            autoComplete="email"
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(false);
            }}
            data-testid="education-email-input"
            aria-invalid={emailError}
            aria-describedby={emailError ? emailErrorId : undefined}
            className={`w-full rounded-md border bg-bg-base px-3 py-2 text-body-sm text-fg-base outline-none transition-colors placeholder:text-fg-subtle ${
              emailError
                ? 'border-error/70 focus:border-error'
                : 'border-border-default focus:border-accent/55'
            }`}
          />
          {emailError ? (
            <p
              id={emailErrorId}
              role="alert"
              data-testid="education-email-error"
              className="w-full text-body-sm text-error"
            >
              {t('license.education.invalidEmail')}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={busy || email.trim().length === 0}
            data-testid="education-start"
            className="button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('license.education.starting') : t('license.education.startCta')}
          </button>
        </div>
      }
    />
  );
}

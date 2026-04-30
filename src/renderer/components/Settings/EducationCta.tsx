import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { startEducation } from '../../services/educationServer';
import { getDeviceName, getOrMintDeviceId, getOs } from '../../services/deviceFingerprint';
import { Row } from './shared';

/**
 * RL-061 Slice 4 — Education magic-link start CTA.
 *
 * Two visual states:
 *
 *   1. Form: email input + Start button.
 *   2. After a successful POST /education/start: "check your email"
 *      success state. Real token email arrives AFTER the user clicks
 *      the confirmation link in their inbox; the renderer never
 *      auto-pastes for education.
 *
 * Duplicate-email branch surfaces `email-already-active` plus a
 * `canRecover: true` flag — we hand that off to the parent via
 * `onRequestRecovery` so the LicenseSection can pre-fill RecoveryCta
 * with this email and give the user a one-click recovery affordance.
 */
export function EducationCta({
  onRequestRecovery,
}: {
  onRequestRecovery?: (email: string) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const handleStart = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (trimmed.length === 0) return;
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
        case 'email-already-active':
          pushStatusNotice({
            tone: 'info',
            messageKey: 'license.education.notice.alreadyActive',
          });
          if (result.canRecover && onRequestRecovery) {
            onRequestRecovery(trimmed);
          }
          return;
        case 'device-already-active':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.education.notice.duplicateDevice',
          });
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
      <Row
        label={t('license.education.confirmingTitle')}
        hint={t('license.education.confirmingBody', { email: confirmationSentTo })}
      >
        <button
          type="button"
          onClick={() => {
            setConfirmationSentTo(null);
            setEmail('');
          }}
          data-testid="education-restart"
          className="button-secondary w-fit self-end"
        >
          {t('license.education.restart')}
        </button>
      </Row>
    );
  }

  return (
    <Row label={t('license.education.title')} hint={t('license.education.body')}>
      <div className="grid w-full gap-2">
        <input
          type="email"
          aria-label={t('license.education.emailLabel')}
          placeholder={t('license.education.emailPlaceholder')}
          value={email}
          spellCheck={false}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          data-testid="education-email-input"
          className="w-full rounded-[1rem] border border-border/80 bg-background/88 px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
        />
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={busy || email.trim().length === 0}
          data-testid="education-start"
          className="button-primary w-fit self-end disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t('license.education.starting') : t('license.education.startCta')}
        </button>
      </div>
    </Row>
  );
}

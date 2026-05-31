import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from '../../stores/licenseStore';
import { useUIStore } from '../../stores/uiStore';
import { startTrial } from '../../services/trialServer';
import { getDeviceName, getOrMintDeviceId, getOs } from '../../services/deviceFingerprint';
import { SpecRow } from '../ui/SpecRow';

/**
 * RL-061 Slice 4 — Trial start CTA.
 *
 * Sits under `status.kind === 'free'` in LicenseSection. Posts the
 * email/device tuple to `POST /trials/start`; on success the worker
 * returns a signed token in the body which we feed straight into
 * `setLicenseToken` for auto-paste so the user lands on Active
 * without ever seeing a token paste step.
 *
 * Duplicate-email branch surfaces an inline "Recover token" button
 * the user can click to trigger `/licenses/recover/start` (filed in
 * RecoveryCta — emitted by LicenseSection on the
 * `setRecoveryEmailHint`-style state, not directly here).
 */
export function TrialCta({
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
  const setLicenseToken = useLicenseStore((s) => s.setLicenseToken);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const handleStart = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const result = await startTrial({
        email: trimmed,
        deviceId: getOrMintDeviceId(),
        deviceName: getDeviceName(),
        os: getOs(),
      });

      if (result.ok) {
        // Auto-paste the signed token so the user lands on Active
        // without an extra step. setLicenseToken handles the activate
        // call + bucket fetch internally.
        const next = await setLicenseToken(result.token);
        if (next.kind === 'active' || next.kind === 'grace') {
          pushStatusNotice({
            tone: 'success',
            messageKey: 'license.trial.notice.activated',
          });
          setEmail('');
          return;
        }
        pushStatusNotice({
          tone: 'error',
          messageKey: 'license.notice.invalid',
        });
        return;
      }

      // Tagged-union failure mapping. We never surface server text;
      // the UI gets a translated key per reason.
      switch (result.reason) {
        case 'trial-unavailable':
          pushStatusNotice({
            tone: 'info',
            messageKey: 'license.trial.notice.unavailable',
          });
          if (result.canRecover && onRequestRecovery) {
            onRequestRecovery(trimmed);
          }
          return;
        case 'rate-limited':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.trial.notice.rateLimited',
          });
          return;
        case 'not-implemented':
        case 'disabled':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.trial.notice.disabled',
          });
          return;
        case 'invalid-input':
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.trial.notice.invalidEmail',
          });
          return;
        case 'unreachable':
        case 'server-error':
        default:
          pushStatusNotice({
            tone: 'error',
            messageKey: 'license.trial.notice.unreachable',
          });
          return;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SpecRow
      last={last}
      label={t('license.trial.title')}
      description={t('license.trial.body')}
      control={
        <div className="flex w-full max-w-[280px] flex-col items-end gap-2">
          <input
            type="email"
            aria-label={t('license.trial.emailLabel')}
            placeholder={t('license.trial.emailPlaceholder')}
            value={email}
            spellCheck={false}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            data-testid="trial-email-input"
            className="w-full rounded-md border border-border-default bg-bg-base px-3 py-2 text-[12.5px] text-fg-base outline-none transition-colors placeholder:text-fg-subtle focus:border-accent/55"
          />
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={busy || email.trim().length === 0}
            data-testid="trial-start"
            className="button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('license.trial.starting') : t('license.trial.startCta')}
          </button>
        </div>
      }
    />
  );
}

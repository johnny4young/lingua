import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeLicenseJwkThumbprint } from '../../../shared/license';
import { useLicenseStore, type LicenseStatus } from '../../stores/licenseStore';
import { PUBLIC_KEY_JWK } from '../../stores/licenseWebVerify';
import { useUIStore } from '../../stores/uiStore';
import { getOrMintDeviceId } from '../../services/deviceFingerprint';
import { writeToClipboard } from '../../utils/clipboard';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { DeviceList } from './DeviceList';
import { EducationCta } from './EducationCta';
import { ExhaustedDevicesModal } from './ExhaustedDevicesModal';
import { RecoveryCta } from './RecoveryCta';
import { TrialCta } from './TrialCta';

/**
 * License paste / clear surface for RL-059. Intentionally minimal — the
 * verifier + store already own the state machine; this component just
 * gives users a way to hand a token over and read the result back.
 *
 * Errors from `setLicenseToken` surface through the shared status
 * notice so the copy stays consistent with the rest of Settings.
 */

/**
 * Maps a license state onto a `StatusBadge` tone. `active` is the only
 * green/success state; `grace` warns, `invalid` errors, and the quiet
 * `free` / `verifying` states sit on the neutral chip — matching the
 * proto's "plan as a spec row with a system StatusBadge".
 */
function statusBadgeTone(status: LicenseStatus): StatusBadgeTone {
  switch (status.kind) {
    case 'active':
      return 'success';
    case 'grace':
      return 'warning';
    case 'invalid':
      return 'error';
    case 'verifying':
    case 'free':
    default:
      return 'neutral';
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
    // RL-061 Slice 3 follow-up. `invalid-input` means the renderer's
    // request body was rejected by the worker validator — the token is
    // fine but the client and server disagree on the request shape
    // (e.g. an `os` value the worker enum did not accept). Distinct
    // copy so users don't waste time re-pasting a perfectly good
    // token; the developer-facing detail goes to console.warn from
    // licenseServer.ts:warnOnInvalidInput.
    case 'invalid-input':
      return 'license.notice.invalid.requestRejected';
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
  // UX Sweep T14 — reflect a rejected paste on the input itself (aria-invalid
  // + an inline message), not only via the transient toast.
  const [applyErrorKey, setApplyErrorKey] = useState<string | null>(null);
  const applyErrorId = useId();
  const [isApplying, setIsApplying] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  // UX Sweep T2 fold C — whether the remove-license confirm is open.
  // Removing the token drops the user Pro->Free, so it confirms first.
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  // Modal-open is local to this component because the modal is owned by
  // the License section's lifecycle: a paste fails with `devices-exhausted`
  // → modal opens → user remediates or cancels → modal closes. Hoisting
  // it into uiStore would let it survive route changes, which is the
  // wrong shape for this single-step remediation flow.
  const [exhaustedModalOpen, setExhaustedModalOpen] = useState(false);
  const [dismissedExhaustedModal, setDismissedExhaustedModal] = useState(false);

  // RL-143 — RFC 7638 thumbprint of the build-embedded signing key, shown
  // so the operator can verify the running build against the rotation
  // registry (docs/security/license-key-registry.json). Async because the
  // digest goes through WebCrypto; stays null (row hidden) on dev builds
  // that embed no key.
  const [keyThumbprint, setKeyThumbprint] = useState<string | null>(null);
  useEffect(() => {
    if (!PUBLIC_KEY_JWK) return undefined;
    let cancelled = false;
    void computeLicenseJwkThumbprint(PUBLIC_KEY_JWK).then(value => {
      if (!cancelled) setKeyThumbprint(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const status = useLicenseStore(state => state.status);
  const token = useLicenseStore(state => state.token);
  const serverSync = useLicenseStore(state => state.serverSync);
  const devices = useLicenseStore(state => state.devices);
  const deviceLimit = useLicenseStore(state => state.deviceLimit);
  const recoverHint = useLicenseStore(state => state.recoverHint);
  const setLicenseToken = useLicenseStore(state => state.setLicenseToken);
  const clearLicense = useLicenseStore(state => state.clearLicense);
  const removeDevice = useLicenseStore(state => state.removeDevice);
  const clearRecoverHint = useLicenseStore(state => state.clearRecoverHint);
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);
  const isDevicesExhausted = status.kind === 'invalid' && status.reason === 'devices-exhausted';

  // Slice 4 — when a child CTA hits a duplicate-email branch with
  // `canRecover: true`, we capture the email here and pass it down to
  // RecoveryCta as a prefill so the user can recover with one click. The
  // renderer-driven recoverHint (stale-token branch) stays derived at render
  // time so we don't need a synchronous state mirror inside an effect.
  const [recoveryPrefill, setRecoveryPrefill] = useState<string | null>(null);
  const recoveryPrefillEmail = recoverHint?.email ?? recoveryPrefill;

  const handleDismissRecoverHint = useCallback(() => {
    clearRecoverHint();
    setRecoveryPrefill(null);
  }, [clearRecoverHint]);

  // Auto-show the modal for a rehydrated `invalid:devices-exhausted` status
  // without mirroring the status into state from an effect. Closing it marks
  // the current exhausted state dismissed until the user tries Apply again.
  const showExhaustedModal =
    exhaustedModalOpen || (isDevicesExhausted && !dismissedExhaustedModal);

  const handleExhaustedModalClose = useCallback(() => {
    setExhaustedModalOpen(false);
    setDismissedExhaustedModal(true);
  }, []);

  const handleApply = async () => {
    if (isApplying) return;
    setIsApplying(true);
    try {
      const next = await setLicenseToken(draft);
      if (next.kind === 'invalid') {
        // The exhausted case routes through the modal — the user needs
        // a device list + Remove buttons + Retry, not a one-line banner.
        if (next.reason === 'devices-exhausted') {
          setDismissedExhaustedModal(false);
          setExhaustedModalOpen(true);
          return;
        }
        setApplyErrorKey(invalidReasonMessageKey(next));
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
      setApplyErrorKey(null);
      if (next.kind === 'active' || next.kind === 'grace') {
        // Read the post-apply `serverSync` flag imperatively so we see
        // whatever value the store just wrote inside `setLicenseToken`.
        // The closure variable from the selector subscription above
        // reflects the *previous* render and would mis-fire the
        // offline-grace branch on the very first activate.
        const postApplyServerSync = useLicenseStore.getState().serverSync;
        if (postApplyServerSync === 'unreachable') {
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

  const handleRemoveDevice = async (deviceIdToRemove: string) => {
    if (pendingRemovalId !== null) return;
    setPendingRemovalId(deviceIdToRemove);
    try {
      const result = await removeDevice(deviceIdToRemove);
      if (!result.ok) {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'license.devices.removeFailed',
        });
        return;
      }
      // Surface the result in the user-visible bucket. The inline row
      // is rendered for both desktop + web buckets but the renderer
      // only ever activates against `web` itself, so we report the
      // post-removal web count to keep the message concrete.
      pushStatusNotice({
        tone: 'success',
        messageKey: 'license.devices.removeSucceeded',
        values: {
          remaining: result.devices.web.length,
          limit: result.deviceLimit.web,
          surface: t('license.devices.surface.web'),
        },
      });
    } finally {
      setPendingRemovalId(null);
    }
  };

  const handleCopyFingerprint = async () => {
    if (!keyThumbprint) return;
    const copied = await writeToClipboard(keyThumbprint);
    pushStatusNotice(
      copied
        ? { tone: 'success', messageKey: 'license.keyFingerprint.copied' }
        : { tone: 'error', messageKey: 'license.keyFingerprint.copyFailed' }
    );
  };

  const runClear = async () => {
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

  const showCtas =
    status.kind === 'free' ||
    (status.kind === 'invalid' && !isDevicesExhausted);

  return (
    <SettingsSection eyebrow={t('license.title')} description={t('license.description')}>
      {/* Current plan — proto's spec row with a system StatusBadge. */}
      <SpecCard>
        <SpecRow
          last
          label={t('license.current.label')}
          description={t('license.current.hint')}
          control={
            <div className="flex items-center gap-2">
              <span data-testid="license-status-pill" aria-live="polite">
                <StatusBadge tone={statusBadgeTone(status)} dot>
                  {t(statusLabelKey(status), { tier: tierLabel(t, status) })}
                </StatusBadge>
              </span>
              {token ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  disabled={isClearing || isApplying}
                  className="focus-ring rounded-md border border-border-default px-2 py-0.5 text-caption text-fg-muted transition-colors hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="license-clear"
                >
                  {t('license.clear')}
                </button>
              ) : null}
            </div>
          }
        />
      </SpecCard>

      {/* RL-143 — embedded signing-key fingerprint. Rendered only when the
          build embeds a public key; the operator cross-checks this value
          against docs/security/license-key-registry.json when rotating. */}
      {keyThumbprint ? (
        <SpecCard>
          <SpecRow
            last
            label={t('license.keyFingerprint.label')}
            description={t('license.keyFingerprint.hint')}
            control={
              <div className="flex items-center gap-2">
                <code
                  data-testid="license-key-fingerprint"
                  title={keyThumbprint}
                  className="max-w-[200px] truncate font-mono text-caption text-fg-muted"
                >
                  {keyThumbprint}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyFingerprint()}
                  data-testid="license-key-fingerprint-copy"
                  className="focus-ring rounded-md border border-border-default px-2 py-0.5 text-caption text-fg-muted transition-colors hover:text-fg-base"
                >
                  {t('license.keyFingerprint.copy')}
                </button>
              </div>
            }
          />
        </SpecCard>
      ) : null}

      {/* Paste a license token. */}
      <SpecCard>
        <SpecRow
          last
          label={t('license.paste.label')}
          description={t('license.paste.hint')}
          control={
            <div className="flex w-full max-w-[320px] flex-col items-end gap-2">
              <textarea
                aria-label={t('license.paste.label')}
                placeholder={t('license.paste.placeholder')}
                value={draft}
                spellCheck={false}
                onChange={event => {
                  setDraft(event.target.value);
                  // Editing clears the rejected-token state.
                  if (applyErrorKey) setApplyErrorKey(null);
                }}
                data-testid="license-input"
                aria-invalid={applyErrorKey !== null}
                aria-describedby={applyErrorKey ? applyErrorId : undefined}
                className={`min-h-20 w-full rounded-md border bg-bg-base px-3 py-2 font-mono text-body-sm text-fg-base outline-none transition-colors placeholder:text-fg-subtle ${
                  applyErrorKey
                    ? 'border-error/70 focus:border-error'
                    : 'border-border-default focus:border-accent/55'
                }`}
              />
              {applyErrorKey ? (
                <p
                  id={applyErrorId}
                  data-testid="license-input-error"
                  className="w-full text-body-sm text-error"
                >
                  {t(applyErrorKey)}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={isApplying || isClearing || draft.trim().length === 0}
                data-testid="license-apply"
                className="button-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isApplying ? t('license.applying') : t('license.apply')}
              </button>
            </div>
          }
        />
      </SpecCard>

      {showCtas ? (
        <>
          <SpecCard>
            <TrialCta onRequestRecovery={(email) => setRecoveryPrefill(email)} />
            <EducationCta onRequestRecovery={(email) => setRecoveryPrefill(email)} />
            <RecoveryCta
              key={recoveryPrefillEmail ?? 'empty-recovery-prefill'}
              prefilledEmail={recoveryPrefillEmail ?? undefined}
              last
            />
          </SpecCard>
          {recoverHint ? (
            <div
              className="rounded-md border border-warning-border bg-warning-bg px-3.5 py-3 text-body-sm leading-5 text-warning-fg"
              data-testid="license-recover-hint"
            >
              <p className="mb-2">{t('license.recovery.staleHint', { email: recoverHint.email })}</p>
              <button
                type="button"
                onClick={handleDismissRecoverHint}
                className="text-caption text-warning-fg underline-offset-2 hover:underline"
              >
                {t('license.recovery.dismissHint')}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {(status.kind === 'active' || status.kind === 'grace') &&
      serverSync === 'synced' &&
      devices &&
      deviceLimit ? (
        <div data-testid="license-devices-row">
          <SpecCard className="py-[14px]">
            <div className="space-y-1">
              <p className="text-body font-medium text-fg-base">{t('license.devices.title')}</p>
              <p className="text-caption leading-5 text-fg-subtle">
                {t('license.devices.hint', {
                  desktop: deviceLimit.desktop,
                  web: deviceLimit.web,
                })}
              </p>
            </div>
            <div className="mt-3">
              <DeviceList
                devices={devices}
                deviceLimit={deviceLimit}
                currentDeviceId={getOrMintDeviceId()}
                pendingRemovalId={pendingRemovalId}
                onRemove={(deviceId) => void handleRemoveDevice(deviceId)}
              />
            </div>
          </SpecCard>
        </div>
      ) : null}

      {showExhaustedModal ? <ExhaustedDevicesModal onClose={handleExhaustedModalClose} /> : null}

      {confirmClear ? (
        <ConfirmDialog
          testId="license-clear-confirm"
          title={t('license.clearConfirm.title')}
          body={t('license.clearConfirm.body')}
          confirmLabel={t('license.clearConfirm.confirm')}
          cancelLabel={t('license.clearConfirm.cancel')}
          onConfirm={() => {
            setConfirmClear(false);
            void runClear();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </SettingsSection>
  );
}

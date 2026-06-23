import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from '../../stores/licenseStore';
import { useUIStore } from '../../stores/uiStore';
import { getOrMintDeviceId } from '../../services/deviceFingerprint';
import { OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { DeviceList } from './DeviceList';

/**
 * RL-061 Slice 3 — exhausted-devices remediation modal.
 *
 * Mounts when `setLicenseToken(...)` returned
 * `{ kind: 'invalid', reason: 'devices-exhausted' }`. The store keeps
 * the original token in that case (Slice 2.5 contract) so the user can
 * remove a device + click Retry without re-pasting from their email.
 *
 * On open the modal calls `revalidate()` so the device list reflects
 * server truth (a sibling tab may have already removed a device by the
 * time the user got here). On Retry it re-runs `setLicenseToken` with
 * the still-cached token. On Cancel it falls back to Free via
 * `clearLicense()`.
 *
 * Web-only — desktop's licenseStore branch returns `not-implemented`
 * from `removeDevice` until Slice 3.5 wires the main bridge into the
 * server. The modal therefore never opens on desktop because the
 * `devices-exhausted` reason is web-side only.
 */
export interface ExhaustedDevicesModalProps {
  onClose: () => void;
}

export function ExhaustedDevicesModal({ onClose }: ExhaustedDevicesModalProps) {
  const { t } = useTranslation();
  const token = useLicenseStore((state) => state.token);
  const devices = useLicenseStore((state) => state.devices);
  const deviceLimit = useLicenseStore((state) => state.deviceLimit);
  const revalidate = useLicenseStore((state) => state.revalidate);
  const setLicenseToken = useLicenseStore((state) => state.setLicenseToken);
  const removeDevice = useLicenseStore((state) => state.removeDevice);
  const clearLicense = useLicenseStore((state) => state.clearLicense);
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);

  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Refresh from /licenses/status on open so the list isn't stale.
  // Errors are swallowed — a stale list is a recoverable UX hiccup;
  // a thrown promise would orphan the modal in a loading state. If the
  // refresh resolves back to a usable license, dismiss the remediation
  // flow because another tab may have already freed a slot.
  useEffect(() => {
    void revalidate()
      .then((next) => {
        if (next.kind === 'active' || next.kind === 'grace') {
          onClose();
        }
      })
      .catch(() => undefined);
  }, [onClose, revalidate]);

  const currentDeviceId = getOrMintDeviceId();
  // The bucket the user actually needs to free — `setLicenseToken`
  // only marks the slice exhausted on the surface that hit its cap.
  // Web is the only surface the renderer itself activates against
  // today; show that bucket's count in the body copy.
  const surfaceLabel = t('license.devices.surface.web');

  const handleRemove = async (deviceIdToRemove: string) => {
    if (pendingRemovalId !== null || isRetrying) return;
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
      const remaining = result.devices.web.length;
      const limit = result.deviceLimit.web;
      pushStatusNotice({
        tone: 'success',
        messageKey: 'license.devices.removeSucceeded',
        values: {
          remaining,
          limit,
          surface: surfaceLabel,
        },
      });
    } finally {
      setPendingRemovalId(null);
    }
  };

  const handleRetry = async () => {
    if (!token || pendingRemovalId !== null || isRetrying) return;
    setIsRetrying(true);
    try {
      const next = await setLicenseToken(token);
      if (next.kind === 'active' || next.kind === 'grace') {
        onClose();
        return;
      }
      // Still exhausted (or another invalid reason) — leave the modal
      // open so the user can keep removing devices, but surface the
      // failure so they don't think Retry silently succeeded.
      if (next.kind === 'invalid' && next.reason !== 'devices-exhausted') {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'license.notice.invalid',
        });
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCancel = async () => {
    await clearLicense();
    onClose();
  };

  return (
    <OverlayBackdrop>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="license-exhausted-modal-title"
        className="w-[min(92vw,560px)] max-w-none"
        data-testid="license-exhausted-modal"
      >
        <div className="surface-header px-5 py-4">
          <h2
            id="license-exhausted-modal-title"
            className="font-display text-h2 font-semibold tracking-[-0.02em] text-fg-base"
          >
            {t('license.devices.exhaustedModal.title')}
          </h2>
        </div>
        <div className="space-y-4 px-5 py-5 text-body leading-6 text-fg-muted">
          <p>{t('license.devices.exhaustedModal.body', { surface: surfaceLabel })}</p>
          {devices && deviceLimit ? (
            <DeviceList
              devices={devices}
              deviceLimit={deviceLimit}
              currentDeviceId={currentDeviceId}
              pendingRemovalId={pendingRemovalId}
              onRemove={(deviceId) => void handleRemove(deviceId)}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            className="button-secondary"
            onClick={() => void handleCancel()}
            disabled={pendingRemovalId !== null || isRetrying}
            data-testid="license-exhausted-cancel"
          >
            {t('license.devices.exhaustedModal.cancel')}
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => void handleRetry()}
            disabled={!token || pendingRemovalId !== null || isRetrying}
            data-testid="license-exhausted-retry"
          >
            {isRetrying
              ? t('license.applying')
              : t('license.devices.exhaustedModal.retry')}
          </button>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}

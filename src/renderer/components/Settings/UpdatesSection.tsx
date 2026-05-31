import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '../../stores/updateStore';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { Tooltip } from '../ui/chrome';

/**
 * FASE 2a — maps the closed-enum updater status onto a StatusBadge
 * tone. `available`/`downloaded` are the only genuinely positive
 * states (green); `error` is the only failure (red); everything else
 * (idle/unavailable/up-to-date) stays quiet, with `checking` reading
 * as an in-flight `info` while the check is live.
 */
function toneForUpdateStatus(status: UpdateStatus): StatusBadgeTone {
  switch (status) {
    case 'available':
    case 'downloaded':
      return 'success';
    case 'error':
      return 'error';
    case 'checking':
      return 'info';
    default:
      return 'neutral';
  }
}

export function UpdatesSection() {
  const status = useUpdateStore((state) => state.status);
  const supported = useUpdateStore((state) => state.supported);
  const enabled = useUpdateStore((state) => state.enabled);
  const message = useUpdateStore((state) => state.message);
  const releaseName = useUpdateStore((state) => state.releaseName);
  const lastCheckedAt = useUpdateStore((state) => state.lastCheckedAt);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const restartToApply = useUpdateStore((state) => state.restartToApply);
  const { t } = useTranslation();

  const statusLabel = t(`updates.state.${status === 'not-available' ? 'notAvailable' : status}`);
  const displayMessage =
    window.lingua?.platform === 'web' && status === 'unavailable' && !supported && !enabled
      ? t('updates.message.webUnavailable')
      : message;

  const statusControl = (
    <div className="flex flex-col items-end gap-1 text-right">
      <StatusBadge tone={toneForUpdateStatus(status)} dot>
        {statusLabel}
      </StatusBadge>
      {releaseName && <p className="text-xs text-fg-muted">{releaseName}</p>}
      {displayMessage && (
        <p className="max-w-[18rem] text-xs leading-5 text-fg-subtle">{displayMessage}</p>
      )}
      {lastCheckedAt && (
        <p className="text-[11px] text-fg-subtle">
          {t('updates.lastChecked')}: {new Date(lastCheckedAt).toLocaleString()}
        </p>
      )}
    </div>
  );

  const actionsControl = (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => void checkForUpdates()}
        disabled={!supported || !enabled || status === 'checking'}
        className="button-secondary"
      >
        {status === 'checking'
          ? t('updates.actions.checking')
          : t('updates.actions.check')}
      </button>
      <Tooltip
        content={
          status === 'downloaded'
            ? t('updates.actions.restart')
            : t('updates.restart.disabledTooltip')
        }
      >
        <button
          type="button"
          onClick={() => void restartToApply()}
          disabled={status !== 'downloaded'}
          aria-label={
            status === 'downloaded'
              ? t('updates.actions.restart')
              : t('updates.restart.disabledTooltip')
          }
          className="button-primary"
        >
          {t('updates.actions.restart')}
        </button>
      </Tooltip>
    </div>
  );

  return (
    <SettingsSection eyebrow={t('updates.title')} description={t('updates.description')}>
      <SpecCard>
        <SpecRow
          label={t('updates.status.label')}
          description={t('updates.status.hint')}
          control={statusControl}
        />
        <SpecRow
          label={t('updates.actions.label')}
          description={t('updates.actions.hint')}
          control={actionsControl}
          last
        />
      </SpecCard>
    </SettingsSection>
  );
}

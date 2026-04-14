import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '../../stores/updateStore';
import { Row, Section } from './shared';

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

  return (
    <Section
      title={t('updates.title')}
      description={t('updates.description')}
    >
      <Row label={t('updates.status.label')} hint={t('updates.status.hint')}>
        <div className="space-y-1 text-right">
          <p className="status-pill">{statusLabel}</p>
          {releaseName && <p className="text-xs text-muted">{releaseName}</p>}
          {message && <p className="max-w-[18rem] text-xs leading-5 text-muted">{message}</p>}
          {lastCheckedAt && (
            <p className="text-[11px] text-muted">
              {t('updates.lastChecked')}: {new Date(lastCheckedAt).toLocaleString()}
            </p>
          )}
        </div>
      </Row>

      <Row label={t('updates.actions.label')} hint={t('updates.actions.hint')}>
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
          <button
            type="button"
            onClick={() => void restartToApply()}
            disabled={status !== 'downloaded'}
            className="button-primary"
          >
            {t('updates.actions.restart')}
          </button>
        </div>
      </Row>
    </Section>
  );
}

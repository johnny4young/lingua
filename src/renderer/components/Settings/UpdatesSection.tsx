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

  return (
    <Section
      title="Updates"
      description="Desktop update status is surfaced here; web builds show capability limits explicitly."
    >
      <Row label="Status" hint={message}>
        <div className="space-y-1 text-right">
          <p className="status-pill">{status}</p>
          {releaseName && <p className="text-xs text-muted">{releaseName}</p>}
          {lastCheckedAt && (
            <p className="text-[11px] text-muted">
              Last check: {new Date(lastCheckedAt).toLocaleString()}
            </p>
          )}
        </div>
      </Row>

      <Row label="Actions" hint="These controls stay disabled when updates are not supported.">
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => void checkForUpdates()}
            disabled={!supported || !enabled || status === 'checking'}
            className="button-secondary"
          >
            {status === 'checking' ? 'Checking...' : 'Check now'}
          </button>
          <button
            onClick={() => void restartToApply()}
            disabled={status !== 'downloaded'}
            className="button-primary"
          >
            Restart to update
          </button>
        </div>
      </Row>
    </Section>
  );
}

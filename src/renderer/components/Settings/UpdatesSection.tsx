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
    <Section title="Updates">
      <Row label="Status">
        <div className="max-w-[60%] text-right">
          <p className="text-xs text-gray-300">{message}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">{status}</p>
          {releaseName && <p className="mt-1 text-[11px] text-gray-500">{releaseName}</p>}
          {lastCheckedAt && (
            <p className="mt-1 text-[11px] text-gray-600">
              Last check: {new Date(lastCheckedAt).toLocaleString()}
            </p>
          )}
        </div>
      </Row>
      <Row label="Actions">
        <div className="flex gap-2">
          <button
            onClick={() => void checkForUpdates()}
            disabled={!supported || !enabled || status === 'checking'}
            className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'checking' ? 'Checking...' : 'Check now'}
          </button>
          <button
            onClick={() => void restartToApply()}
            disabled={status !== 'downloaded'}
            className="rounded bg-primary-500/20 px-3 py-1 text-xs text-primary-400 transition-colors hover:bg-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Restart to update
          </button>
        </div>
      </Row>
    </Section>
  );
}

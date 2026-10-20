import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';

/** Keyed by the newest run, so the sweep plays once per completed run even after the history caps. */
export function RunSweep() {
  const lastRunId = useExecutionHistoryStore(state => state.entries.at(-1)?.id);
  if (!lastRunId) return null;
  return <span key={lastRunId} aria-hidden data-testid="run-sweep" className="run-sweep" />;
}

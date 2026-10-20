import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';

/** Keyed by the run count, so the sweep plays once per completed run. */
export function RunSweep() {
  const runs = useExecutionHistoryStore(state => state.entries.length);
  if (runs === 0) return null;
  return <span key={runs} aria-hidden data-testid="run-sweep" className="run-sweep" />;
}

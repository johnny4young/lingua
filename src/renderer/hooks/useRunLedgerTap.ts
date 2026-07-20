import { useEffect, useRef } from 'react';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { recordRun } from '../runtime/runLedger';

/**
 * internal — the Run Ledger tap. Subscribes ONCE (app-level, mounted from
 * `App` next to the onboarding choreography) to the execution history
 * store and forwards each NEW entry to the ledger, fire-and-forget.
 *
 * Why the history store is the right choke point: its `record()` call
 * sites are exactly the meaningful runs — the manual editor orchestrator
 * (`executeTabManually`, both the clean and the throw path), the SQL and
 * HTTP workspaces, and utility pipelines. Auto-runs never record there
 * (so a scratchpad keystroke storm cannot flood the ledger) and history
 * replays pass `recordHistory: false`.
 *
 * The `lastSeenId` guard keys on the newest entry's id, not array
 * identity: the ring array is also re-minted by non-run mutations
 * (togglePin, clearCapsule) whose newest entry is one the tap already
 * forwarded.
 */
export function useRunLedgerTap(): void {
  const lastSeenIdRef = useRef<string | null>(null);

  useEffect(() => {
    const forward = (entries: ReturnType<typeof useExecutionHistoryStore.getState>['entries']) => {
      const latest = entries[entries.length - 1];
      if (!latest || latest.id === lastSeenIdRef.current) return;
      lastSeenIdRef.current = latest.id;
      recordRun({
        language: latest.language,
        status: latest.status,
        durationMs: latest.durationMs,
        startedAtMs: latest.timestamp,
        tabId: latest.tabId ?? null,
        code: latest.snapshot?.code ?? null,
        contentHash: latest.lastCapsule?.source.contentHash ?? null,
        capsule: latest.lastCapsule ?? null,
      });
    };

    // Seed the guard with the current newest entry WITHOUT forwarding it:
    // entries that predate the tap (or this mount) were either already
    // forwarded or happened while the ledger was off — recording them
    // retroactively would violate the opt-in expectation.
    const initial = useExecutionHistoryStore.getState().entries;
    lastSeenIdRef.current = initial[initial.length - 1]?.id ?? null;

    return useExecutionHistoryStore.subscribe((state, prev) => {
      if (state.entries === prev.entries) return;
      forward(state.entries);
    });
  }, []);
}

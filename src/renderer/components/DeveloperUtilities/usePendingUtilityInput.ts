/**
 * internal — consume the one-shot input seed the smart-paste router leaves
 * in the utility-history store.
 *
 * Each target panel calls this with its id and an `apply` callback that
 * writes the seed into the panel's own input state. The hook works for
 * BOTH lifecycles: a fresh mount (the workspace just opened on this
 * panel) and an already-mounted panel that is re-activated while the
 * Utilities tab stays open — the store subscription fires either way.
 * The slot clears immediately after applying, so a later manual visit to
 * the same panel never replays a stale paste.
 */

import { useEffect, useRef } from 'react';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useUtilityHistoryStore } from '../../stores/utilityHistoryStore';

export function usePendingUtilityInput(
  utilityId: DeveloperUtilityId,
  apply: (input: string) => void
): void {
  const pending = useUtilityHistoryStore(state =>
    state.pendingUtilityInput?.utilityId === utilityId
      ? state.pendingUtilityInput.input
      : null
  );
  // The apply callback closes over panel setters; keep the latest without
  // re-running the effect when the panel re-renders.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (pending == null) return;
    applyRef.current(pending);
    useUtilityHistoryStore.getState().setPendingUtilityInput(null);
  }, [pending]);
}

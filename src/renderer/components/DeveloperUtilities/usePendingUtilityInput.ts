/**
 * internal — consume the one-shot input seed the smart-paste router leaves
 * in the utility-workspace store.
 *
 * Each target panel calls this with its id and an `apply` callback that
 * writes the seed into the panel's own input state. The hook works for
 * BOTH lifecycles: a fresh mount (the workspace just opened on this
 * panel) and an already-mounted panel that is re-activated while the
 * Utilities tab stays open — the store subscription fires either way.
 * The slot clears immediately after applying, so a later manual visit to
 * the same panel never replays a stale paste.
 */

import { useEffect, useEffectEvent } from 'react';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useUtilityWorkspaceStore } from '../../stores/utilityWorkspaceStore';

export function usePendingUtilityInput(
  utilityId: DeveloperUtilityId,
  apply: (input: string) => void
): void {
  const pending = useUtilityWorkspaceStore(state =>
    state.pendingUtilityInput?.utilityId === utilityId
      ? state.pendingUtilityInput.input
      : null
  );
  // Smart-paste delivery is an external store event. Effect Events keep the
  // latest panel callback without mutating refs during render or making an
  // inline callback identity retrigger the one-shot subscription.
  const applyPendingInput = useEffectEvent(apply);

  useEffect(() => {
    if (pending == null) return;
    applyPendingInput(pending);
    useUtilityWorkspaceStore.getState().setPendingUtilityInput(null);
  }, [pending]);
}

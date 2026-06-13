import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { sessionSnapshotEqual, useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * RL-147 (AUDIT-27) — debounced session auto-save, extracted from
 * App.tsx (RL-131 hook-extraction pattern).
 *
 * Subscribes to the editor store and schedules `saveSession()` 1 s
 * after the last SAVE-RELEVANT change. The `sessionSnapshotEqual`
 * guard is the point of this hook: before it, every store mutation —
 * `pendingReveal`, `isDirty` churn, per-run `setTabExecutionState`
 * flips — cleared and re-armed the timer, so an active run/reveal
 * burst postponed the actual save indefinitely (audit finding §3.10).
 * Now only mutations that change the persisted snapshot re-arm it,
 * and unrelated bursts can no longer delay a pending save.
 *
 * Flush-on-exit: `saveSession()`'s only caller is this debounce, so
 * without a flush, closing the tab (web) or quitting within the 1 s
 * window silently lost the last edits. `pagehide` plus
 * `visibilitychange: hidden` flush a PENDING save immediately; when no
 * save is pending there is nothing newer than the last snapshot, so
 * the flush is a no-op.
 *
 * `smokeEnabled` keeps the hook fully inert during desktop smoke runs,
 * matching the prior inline effect's contract.
 */
export function useSessionAutoSave(smokeEnabled: boolean): void {
  useEffect(() => {
    if (smokeEnabled) {
      return undefined;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    const flushPendingSave = () => {
      if (timeout === undefined) {
        return;
      }
      clearTimeout(timeout);
      timeout = undefined;
      useSessionStore.getState().saveSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingSave();
      }
    };

    const unsubscribe = useEditorStore.subscribe((state, prevState) => {
      // RL-111 — persist the snapshot for both `ask` (so the boot prompt
      // has something to offer) and `always`. `never` writes nothing,
      // which also respects the privacy intent: opting out means no
      // session blob is ever written.
      const { restoreSessionMode } = useSettingsStore.getState();
      if (restoreSessionMode === 'never') {
        return;
      }
      if (sessionSnapshotEqual(state, prevState)) {
        return;
      }

      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        timeout = undefined;
        useSessionStore.getState().saveSession();
      }, 1000);
    });

    window.addEventListener('pagehide', flushPendingSave);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flushPendingSave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    };
  }, [smokeEnabled]);
}

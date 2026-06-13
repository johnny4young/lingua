import { useEffect, useRef, useState } from 'react';
import {
  armPendingSessionRestoreSnapshot,
  useSessionStore,
} from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { isSafeMode } from '../utils/safeBoot';
import { trackEvent } from '../utils/telemetry';

/**
 * RL-111 — boot-time session restore, extracted from App.tsx (RL-131
 * hook-extraction pattern; keeps App.tsx under the AUDIT-11 size budget).
 *
 * Owns the one-time restore decision and returns `sessionRestoreReady`, which
 * gates the rest of the boot sequence. Three closed modes
 * (`SettingsState.restoreSessionMode`):
 *
 *   - `always` — restore the persisted snapshot silently (legacy
 *     `restoreSession: true`), then mark ready.
 *   - `ask`    — if the snapshot holds ≥1 tab, surface a clickable
 *     "Restore N tabs" prompt (`high` priority so a boot-time notice can't
 *     clobber it) and mark ready immediately — boot does NOT block on the
 *     answer. The boot snapshot is pinned in memory until an explicit
 *     restore, so a click long after boot still restores the tabs the prompt
 *     advertised even if autosave records a newer workspace meanwhile.
 *     Privacy-conscious default: reopening after screen-sharing never
 *     auto-surfaces code.
 *   - `never`  — ignore the snapshot; mark ready.
 *
 * RL-090 — safe mode short-circuits restore so a corrupted persisted tab
 * state cannot keep the renderer in a crash loop. `smokeEnabled` keeps the
 * hook inert during desktop smoke runs. The `hasRestoredSessionRef` guard
 * makes the effect idempotent under React 18/19 StrictMode double-mount.
 *
 * @param smokeEnabled when true, restore is skipped and ready is set at once.
 * @returns `sessionRestoreReady` — true once the restore decision resolved.
 */
export function useSessionRestoreBoot(smokeEnabled: boolean): boolean {
  const hasRestoredSessionRef = useRef(false);
  const [sessionRestoreReady, setSessionRestoreReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) {
        setSessionRestoreReady(true);
      }
    };

    if (hasRestoredSessionRef.current || smokeEnabled) {
      finish();
      return;
    }
    hasRestoredSessionRef.current = true;

    if (isSafeMode()) {
      finish();
      return;
    }

    const { restoreSessionMode } = useSettingsStore.getState();

    if (restoreSessionMode === 'always') {
      void (async () => {
        const tabCount = useSessionStore.getState().savedTabs.length;
        await useSessionStore.getState().restoreSession();
        if (tabCount > 0) {
          void trackEvent('session.restored', { tabCount, source: 'auto' });
        }
        finish();
      })();
      return () => {
        cancelled = true;
      };
    }

    if (restoreSessionMode === 'ask') {
      const tabCount = armPendingSessionRestoreSnapshot();
      if (tabCount > 0) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'editor.restoreSession.prompt',
          values: { count: tabCount },
          priority: 'high',
          actions: [
            {
              labelKey: 'editor.restoreSession.promptCta',
              onClick: () => {
                void (async () => {
                  await useSessionStore.getState().restoreSession();
                  void trackEvent('session.restored', { tabCount, source: 'prompt' });
                })();
              },
            },
          ],
          // Fold C — the user let the prompt go (auto-timeout or manual X)
          // without restoring. Measures how often `ask` is declined so we
          // can tune whether `ask` or `always` should be the default.
          onDismiss: (mode) => {
            if (mode !== 'cta') {
              void trackEvent('session.snapshotDiscarded', { tabCount });
            }
          },
        });
      }
    }

    finish();

    return () => {
      cancelled = true;
    };
  }, [smokeEnabled]);

  return sessionRestoreReady;
}

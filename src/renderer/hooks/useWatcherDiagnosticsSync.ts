import { useEffect } from 'react';
import type { WatcherFailureKind } from '../../shared/fs/watcherDiagnostic';
import { useUIStore } from '../stores/uiStore';

const WATCHER_FAILURE_MESSAGE_KEYS: Record<WatcherFailureKind, string> = {
  'permission-denied': 'explorer.watcher.failed.permission-denied',
  'system-limit': 'explorer.watcher.failed.system-limit',
  'path-not-found': 'explorer.watcher.failed.path-not-found',
  unknown: 'explorer.watcher.failed.unknown',
};

function watcherFailureMessageKey(diagnostic: unknown): string {
  const kind =
    typeof diagnostic === 'object' && diagnostic !== null && 'kind' in diagnostic
      ? (diagnostic as { kind?: unknown }).kind
      : undefined;
  return typeof kind === 'string' && kind in WATCHER_FAILURE_MESSAGE_KEYS
    ? WATCHER_FAILURE_MESSAGE_KEYS[kind as WatcherFailureKind]
    : WATCHER_FAILURE_MESSAGE_KEYS.unknown;
}

/**
 * internal — surface watcher reliability problems to the user.
 *
 * Subscribes to two main-process IPC channels:
 *
 * - `fs:watcher-failed` — emitted when `fs.watch()` throws on
 *   registration (EACCES, EMFILE, ENOSPC, ENOENT). Pushed as a
 *   sticky `error` notice with kind-specific copy so the user
 *   knows the file tree may not refresh automatically until they
 *   restart, fix permissions, or raise the FD limit.
 *
 * - `fs:watcher-degraded` — emitted when the watcher reports a
 *   sustained burst of null-filename events (Linux inotify
 *   overflow). Pushed as a `warning` notice (auto-dismiss) so the
 *   user knows to refresh the tree manually if it looks stale.
 *
 * Lives at the top level so the subscription survives across
 * project switches; re-entering this hook (HMR / dev reload)
 * unsubscribes the previous registration to avoid leaks.
 */
export function useWatcherDiagnosticsSync(): void {
  useEffect(() => {
    // Each subscription is independently optional: the web stub
    // exposes both as noops, but during a partial bridge rollout one
    // may be missing while the other is present. Optional chaining
    // means a missing method registers nothing (and `unsubscribe?.()`
    // in cleanup handles that uniformly), so we never half-wire.
    const fsApi = window.lingua?.fs;

    const unsubscribeFailed = fsApi?.onWatcherFailed?.((diagnostic) => {
      useUIStore.getState().pushStatusNotice({
        tone: 'error',
        messageKey: watcherFailureMessageKey(diagnostic),
      });
    });

    const unsubscribeDegraded = fsApi?.onWatcherDegraded?.(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'explorer.watcher.degraded',
      });
    });

    return () => {
      unsubscribeFailed?.();
      unsubscribeDegraded?.();
    };
  }, []);
}

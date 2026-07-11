/** Filesystem watcher registry, lifecycle cleanup, and IPC handlers. */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import {
  asRelativePath,
  asWatchId,
  type RelativePath,
  type WatchId,
} from '../../../shared/fs/brandedIds';
import {
  buildWatcherDiagnostic,
  type WatcherDiagnostic,
} from '../../../shared/fs/watcherDiagnostic';
import type { RootId } from '../projectCapabilities';
import { typedHandle } from '../typedHandle';
import { joinRelative, resolveOrThrow } from './fsShared';

/**
 * Active file system watchers keyed by an opaque watchId. Only main
 * retains the rootId + absolute watched path mapping; the renderer gets
 * an unstructured token it can pass back to stop the watcher.
 */
interface WatcherEntry {
  rootId: RootId;
  watchedPath: string;
  targetKey: string;
  /** webContents id that created the watcher, for lifecycle cleanup. */
  senderId?: number;
  stop: () => void;
}

const watchers = new Map<WatchId, WatcherEntry>();
const watcherIdsByTarget = new Map<string, WatchId>();
// RL-146 hardening (B14) — tie each watcher to the webContents that
// created it so a window close (macOS keeps the app alive with no
// window) or a renderer reload does not leak the recursive project
// watcher. Without this, `before-quit` was the ONLY cleanup for these
// handles, and a reload mints a fresh rootId that never dedups against
// the previous session's watcher. Mirrors the git HEAD watcher registry.
const watcherIdsBySender = new Map<number, Set<WatchId>>();
const senderDestroyedListenerInstalled = new Set<number>();

function rememberWatcherForSender(senderId: number, watchId: WatchId): void {
  let ids = watcherIdsBySender.get(senderId);
  if (!ids) {
    ids = new Set();
    watcherIdsBySender.set(senderId, ids);
  }
  ids.add(watchId);
}

function forgetWatcherForSender(senderId: number, watchId: WatchId): void {
  const ids = watcherIdsBySender.get(senderId);
  if (!ids) return;
  ids.delete(watchId);
  if (ids.size === 0) watcherIdsBySender.delete(senderId);
}

function stopWatcherById(watchId: WatchId): boolean {
  const entry = watchers.get(watchId);
  if (!entry) return false;
  entry.stop();
  watchers.delete(watchId);
  watcherIdsByTarget.delete(entry.targetKey);
  if (entry.senderId !== undefined) {
    forgetWatcherForSender(entry.senderId, watchId);
  }
  // RL-087 — drop the per-watcher burst tracker entry so a long
  // session that opens + closes many projects under inotify load
  // does not accumulate dead UUIDs in the map.
  nullFilenameBursts.delete(watchId);
  return true;
}

/**
 * Tear down every watcher a webContents owns. Wired to the sender's
 * `destroyed` lifecycle event so a window close / reload does not leak
 * fs.watch handles into the next session.
 */
function stopWatchersForSender(senderId: number): void {
  const ids = watcherIdsBySender.get(senderId);
  if (!ids) return;
  // Copy first — stopWatcherById mutates the set via forgetWatcherForSender.
  for (const watchId of [...ids]) {
    stopWatcherById(watchId);
  }
  watcherIdsBySender.delete(senderId);
  senderDestroyedListenerInstalled.delete(senderId);
}

/**
 * RL-087 — purge every active watcher. Called from `before-quit` so
 * Node's fs.watch handles never outlive the process.
 */
export function stopAllWatchers(): void {
  for (const entry of watchers.values()) {
    try {
      entry.stop();
    } catch {
      // Best-effort cleanup — a stop that throws on shutdown should
      // not block the rest of the registry from getting torn down.
    }
  }
  watchers.clear();
  watcherIdsByTarget.clear();
  watcherIdsBySender.clear();
  senderDestroyedListenerInstalled.clear();
  // Clear burst tracker too for parity with `stopWatcherById`.
  // Moot in the `before-quit` path but matters when `stopAllWatchers`
  // is reused for tests.
  nullFilenameBursts.clear();
}

let beforeQuitListenerInstalled = false;

/**
 * RL-087 — install the `before-quit` handler exactly once. Called
 * lazily from `registerFileSystemHandlers` because Electron's `app`
 * is not safe to `app.on(...)` against in test setup that mocks the
 * module without a real lifecycle.
 */
function ensureBeforeQuitCleanup(): void {
  if (beforeQuitListenerInstalled) return;
  if (typeof app?.on !== 'function') return;
  app.on('before-quit', stopAllWatchers);
  beforeQuitListenerInstalled = true;
}

/**
 * RL-087 — null-filename burst tracker. Some platforms (Linux inotify
 * under load) drop the entry name from `fs.watch` callbacks; a sustained
 * burst suggests the watcher is overwhelmed. Track per-watchId and emit
 * `fs:watcher-degraded` once per 5s window when the count crosses the
 * threshold so the renderer can surface a degraded notice.
 */
const NULL_FILENAME_BURST_THRESHOLD = 20;
const NULL_FILENAME_WINDOW_MS = 5_000;

interface NullFilenameBurst {
  count: number;
  windowStart: number;
  notifiedAt: number;
}
const nullFilenameBursts = new Map<WatchId, NullFilenameBurst>();

function recordNullFilenameBurst(watchId: WatchId): boolean {
  const now = Date.now();
  const burst = nullFilenameBursts.get(watchId);
  if (!burst || now - burst.windowStart > NULL_FILENAME_WINDOW_MS) {
    nullFilenameBursts.set(watchId, { count: 1, windowStart: now, notifiedAt: 0 });
    return false;
  }
  burst.count += 1;
  if (
    burst.count >= NULL_FILENAME_BURST_THRESHOLD &&
    now - burst.notifiedAt > NULL_FILENAME_WINDOW_MS
  ) {
    burst.notifiedAt = now;
    return true;
  }
  return false;
}

/**
 * RL-087 — exported for tests so we can simulate a burst without
 * spinning up a real watcher.
 */
export function _resetWatcherBurstTrackerForTests(): void {
  nullFilenameBursts.clear();
}

/**
 * RL-087 — exported for tests that re-run `registerFileSystemHandlers`
 * across cases. Without this, the `beforeQuitListenerInstalled` flag
 * stays true between cases and the second `registerFileSystemHandlers`
 * call becomes a silent no-op.
 */
export function _resetBeforeQuitInstallStateForTests(): void {
  beforeQuitListenerInstalled = false;
}

export function registerWatcherHandlers(): void {
  ensureBeforeQuitCleanup();
  // --------------------------------------------------------------- watch

  typedHandle(
    'fs:watch-start',
    async (event, rootId: RootId, relativePath: RelativePath = asRelativePath('')) => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );
      // NUL is a delimiter the registry already rejects inside both
      // `rootId` and absolute paths, so concatenating with `\0` gives
      // a collision-free dedup key without any escaping ceremony.
      const targetKey = `${rootId}\0${absolutePath}`;
      const existingWatchId = watcherIdsByTarget.get(targetKey);
      if (existingWatchId) {
        stopWatcherById(existingWatchId);
      }
      const watchId = asWatchId(randomUUID());

      // RL-087 — wrap fs.watch in try/catch so registration failures
      // (EACCES, EMFILE, ENOSPC, ENOENT) surface as a typed diagnostic
      // to the renderer instead of crashing the IPC handler.
      let watcher: ReturnType<typeof watch>;
      try {
        watcher = watch(
          absolutePath,
          { recursive: true },
          (eventType, filename) => {
            if (event.sender.isDestroyed()) return;
            if (filename === null) {
              // Some platforms (notably Linux inotify under load) drop
              // the changed entry's name. Surface the watched subtree
              // itself so the renderer refreshes the right scope —
              // emitting `''` (project root) would mis-route events
              // when the renderer ever watches a subdirectory.
              event.sender.send('fs:changed', {
                rootId,
                relativePath,
                eventType,
                filename: null,
              });
              // Track null-filename frequency. A sustained burst means
              // the watcher is dropping events and the user should know
              // the tree may go stale.
              if (recordNullFilenameBurst(watchId)) {
                const diagnostic: WatcherDiagnostic = {
                  kind: 'system-limit',
                  rootId,
                  relativePath,
                  errorMessage: 'Watcher reported a sustained burst of null-filename events.',
                };
                event.sender.send('fs:watcher-degraded', diagnostic);
              }
              return;
            }
            // The watcher reports filenames relative to the watched
            // dir; convert to a path relative to the project root so
            // the renderer always speaks the same coordinate space.
            const fileName = String(filename);
            const eventRelative = asRelativePath(
              joinRelative(relativePath, fileName)
            );
            event.sender.send('fs:changed', {
              rootId,
              relativePath: eventRelative,
              eventType,
              filename: fileName,
            });
          }
        );
      } catch (error) {
        const diagnostic = buildWatcherDiagnostic(error, rootId, relativePath);
        if (!event.sender.isDestroyed()) {
          event.sender.send('fs:watcher-failed', diagnostic);
        }
        return { ok: false, diagnostic } as const;
      }

      const senderId = event.sender.id;
      watchers.set(watchId, {
        rootId,
        watchedPath: absolutePath,
        targetKey,
        senderId,
        stop: () => watcher.close(),
      });
      watcherIdsByTarget.set(targetKey, watchId);
      rememberWatcherForSender(senderId, watchId);

      // Tie the watcher to the sender's lifecycle so a window close
      // (macOS keeps the app alive) or a renderer reload disposes it
      // instead of leaking the recursive fs.watch. Install the listener
      // AT MOST ONCE per sender id — every watch-start on the same
      // sender otherwise queues another `destroyed` listener. Mirrors
      // the git HEAD watcher registry.
      if (!senderDestroyedListenerInstalled.has(senderId)) {
        senderDestroyedListenerInstalled.add(senderId);
        event.sender.once('destroyed', () => {
          stopWatchersForSender(senderId);
        });
      }

      // A recursive FSWatcher can also fail asynchronously long after
      // registration (EPERM on Windows when the watched folder is deleted
      // or renamed, deferred ENOSPC/EMFILE). Without an 'error' listener
      // that emission becomes an uncaught exception that takes down the
      // whole main process — the registration try/catch above only covers
      // synchronous failures. Mirror the git HEAD watcher's posture:
      // close + deregister + typed diagnostic to the renderer.
      watcher.on('error', (error) => {
        stopWatcherById(watchId);
        const diagnostic = buildWatcherDiagnostic(error, rootId, relativePath);
        if (!event.sender.isDestroyed()) {
          event.sender.send('fs:watcher-failed', diagnostic);
        }
      });
      return watchId;
    }
  );

  typedHandle('fs:watch-stop', (_event, watchId: string) => {
    // Boundary cast: the renderer hands back the opaque token main
    // returned from `fs:watch-start`. Branding the raw IPC string here is
    // the sanctioned mint point; `stopWatcherById` is a no-op for any
    // token not present in the registry.
    stopWatcherById(asWatchId(watchId));
    return true;
  });
}

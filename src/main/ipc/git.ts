/**
 * RL-102 Slice 1 — IPC handlers for the Git read-only layer.
 *
 * Three channels:
 *
 *   - `git:detect` accepts a folder path and returns
 *     `{ installed, version?, repoRoot?, branch? }`. Renderer calls
 *     this once per project root change.
 *   - `git:status` accepts `repoRoot` + `filePath` and returns the
 *     porcelain status bucket + numstat counts. Watcher-driven; the
 *     renderer debounces to keep the spawn rate sane.
 *   - `git:diff` accepts `repoRoot` + `filePath` and returns both
 *     diff sides as strings (Monaco diff editor input).
 *
 * Input validation lives in `src/main/git.ts` (path-traversal guard
 * via `validateRepoRelativePath`); this module is a thin marshaling
 * layer that only normalizes the raw IPC tuple into typed arguments.
 *
 * Slice 1 is read-only. There is no write surface; a future slice
 * with `git:add` / `git:commit` would register here too, behind an
 * explicit feature gate.
 */

import path from 'node:path';
import { ipcMain } from 'electron';
import {
  detectGit,
  getFileDiff,
  getFileStatus,
  revealRepo,
  watchRepoHead,
  type GitDetectResult,
  type GitFileDiff,
  type GitFileStatus,
  type GitHeadChangePayload,
  type GitHeadWatcher,
  type GitHeadWatcherDiagnostic,
} from '../git';
import {
  pathInsideApprovedScope,
  pathIntersectsApprovedScope,
} from './fileSystem';
import { isPathBlocked } from './permissions';

/**
 * RL-077-alignment gate for the git read-only layer. The git handlers are
 * the one IPC surface that receives raw absolute paths (the repo toplevel
 * can sit ABOVE the approved project root, so a rootId capability cannot
 * express it). Before this gate they accepted ANY path — `git:diff` would
 * read file contents out of arbitrary repos on disk if the renderer were
 * compromised. Now a path must (a) not fall in the filesystem denylist and
 * (b) intersect the user-approved scope (be an approved root, live inside
 * one, or be an ancestor of one — the monorepo case).
 */
async function isApprovedGitScope(absolutePath: string): Promise<boolean> {
  if (isPathBlocked(absolutePath, 'read')) return false;
  return pathIntersectsApprovedScope(absolutePath);
}

/**
 * File-level gate for the content-reading git channels (`git:status`,
 * `git:diff`). The repoRoot gate alone is not enough: in the monorepo case
 * the approved scope is a SUBFOLDER of the repo toplevel, so any file under
 * the toplevel — including unversioned secrets in sibling packages or the
 * repo root's `.env` — would pass the ancestor arm of the root gate while
 * sitting outside what the user actually approved. Content reads therefore
 * also require the individual file to sit inside the approved scope and to
 * clear the filesystem denylist.
 *
 * `rawFilePath` may arrive relative (to `repoRoot`) or absolute; both are
 * resolved against the repo root before the check.
 */
async function isApprovedGitFile(
  repoRoot: string,
  rawFilePath: string
): Promise<boolean> {
  let absoluteFile: string;
  try {
    absoluteFile = path.resolve(repoRoot, rawFilePath);
  } catch {
    return false;
  }
  if (isPathBlocked(absoluteFile, 'read')) return false;
  return pathInsideApprovedScope(absoluteFile);
}

/**
 * RL-102 Slice 2 — per-sender head-watch registry.
 *
 * Keyed by `webContents.id` × `repoRoot`. The map lets us reuse a
 * single underlying `fs.watch` per repo even if the renderer's hook
 * calls `git:watch-head` twice during a render cycle, and disposes
 * cleanly when the renderer navigates away from the project.
 *
 * Lifecycle:
 *   - `git:watch-head` adds a watcher, broadcasts to the sender.
 *   - `git:unwatch-head` (or a `webContents.destroyed` event) disposes
 *     it.
 *   - Window close is covered by the sender `destroyed` event.
 */
type WatcherKey = string;
const headWatchers = new Map<WatcherKey, GitHeadWatcher>();
const watchersBySender = new Map<number, Set<WatcherKey>>();
// Reviewer pass — track which sender ids already have a `destroyed`
// listener installed. Without this, every `git:watch-head` for a
// new repoRoot on the same sender would register an additional
// `once('destroyed', ...)`, and a project switch followed by a few
// re-watches would accumulate listeners. The listener itself is
// idempotent (`disposeAllForSender` is a no-op on an empty Set) but
// the registration count is unbounded.
const destroyedListenerInstalled = new Set<number>();

function watcherKey(senderId: number, repoRoot: string): WatcherKey {
  return `${senderId}::${repoRoot}`;
}

function disposeWatcher(key: WatcherKey): void {
  const existing = headWatchers.get(key);
  if (existing) {
    existing.dispose();
    headWatchers.delete(key);
  }
}

function rememberWatcherForSender(
  senderId: number,
  key: WatcherKey
): void {
  let keys = watchersBySender.get(senderId);
  if (!keys) {
    keys = new Set();
    watchersBySender.set(senderId, keys);
  }
  keys.add(key);
}

function forgetWatcherForSender(senderId: number, key: WatcherKey): void {
  const keys = watchersBySender.get(senderId);
  if (!keys) return;
  keys.delete(key);
  if (keys.size === 0) watchersBySender.delete(senderId);
}

/**
 * Tear down all watchers a webContents owns. Wired to the
 * `destroyed` lifecycle event so a navigation / window close does
 * not leak `fs.watch` handles into the next session.
 */
function disposeAllForSender(senderId: number): void {
  const keys = watchersBySender.get(senderId);
  if (!keys) return;
  for (const key of keys) {
    disposeWatcher(key);
  }
  watchersBySender.delete(senderId);
}

export function registerGitHandlers(): void {
  ipcMain.handle(
    'git:detect',
    async (_event, rawFolderPath: unknown): Promise<GitDetectResult> => {
      const folderPath =
        typeof rawFolderPath === 'string' && rawFolderPath.length > 0
          ? rawFolderPath
          : undefined;
      // Unapproved folder → degrade to binary-only detection (no repo
      // probing of the supplied path), same shape the renderer already
      // handles for a folder that is not a git repo.
      if (folderPath && !(await isApprovedGitScope(folderPath))) {
        return detectGit(undefined);
      }
      return detectGit(folderPath);
    }
  );

  ipcMain.handle(
    'git:status',
    async (
      _event,
      rawRepoRoot: unknown,
      rawFilePath: unknown
    ): Promise<GitFileStatus> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return { status: 'unknown' };
      }
      if (typeof rawFilePath !== 'string' || rawFilePath.length === 0) {
        return { status: 'unknown' };
      }
      if (!(await isApprovedGitScope(rawRepoRoot))) {
        return { status: 'unknown' };
      }
      if (!(await isApprovedGitFile(rawRepoRoot, rawFilePath))) {
        return { status: 'unknown' };
      }
      return getFileStatus(rawRepoRoot, rawFilePath);
    }
  );

  ipcMain.handle(
    'git:diff',
    async (
      _event,
      rawRepoRoot: unknown,
      rawFilePath: unknown
    ): Promise<GitFileDiff> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return { originalContent: '', modifiedContent: '', truncated: false };
      }
      if (typeof rawFilePath !== 'string' || rawFilePath.length === 0) {
        return { originalContent: '', modifiedContent: '', truncated: false };
      }
      if (!(await isApprovedGitScope(rawRepoRoot))) {
        return { originalContent: '', modifiedContent: '', truncated: false };
      }
      if (!(await isApprovedGitFile(rawRepoRoot, rawFilePath))) {
        return { originalContent: '', modifiedContent: '', truncated: false };
      }
      return getFileDiff(rawRepoRoot, rawFilePath);
    }
  );

  // RL-102 Slice 2 — `Reveal in Source Control` action. Returns a
  // boolean so the renderer can push a localized error notice on
  // false. Input validation lives in `revealRepo` (existence probe
  // + path normalization).
  ipcMain.handle(
    'git:reveal',
    async (_event, rawRepoRoot: unknown): Promise<boolean> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return false;
      }
      if (!(await isApprovedGitScope(rawRepoRoot))) {
        return false;
      }
      return revealRepo(rawRepoRoot);
    }
  );

  // RL-102 Slice 2 — start a HEAD watcher for `repoRoot` and stream
  // `git:on-head-changed` events to the renderer that called us.
  // Returns the resolved initial state so the renderer can warm its
  // store without waiting for the first watch event.
  ipcMain.handle(
    'git:watch-head',
    async (event, rawRepoRoot: unknown): Promise<{ ok: boolean }> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return { ok: false };
      }
      if (!(await isApprovedGitScope(rawRepoRoot))) {
        return { ok: false };
      }
      const repoRoot = rawRepoRoot;
      const senderId = event.sender.id;
      const key = watcherKey(senderId, repoRoot);
      // If a watcher already exists for this sender + repo, return
      // ok without reinstalling — the renderer hook short-circuits
      // on dedup but defense in depth keeps us from leaking handles.
      if (headWatchers.has(key)) {
        return { ok: true };
      }
      const sender = event.sender;
      const sendChange = (payload: GitHeadChangePayload): void => {
        if (sender.isDestroyed()) return;
        try {
          sender.send('git:on-head-changed', payload);
        } catch {
          /* sender gone */
        }
      };
      const sendDiagnostic = (diag: GitHeadWatcherDiagnostic): void => {
        if (sender.isDestroyed()) return;
        try {
          sender.send('git:on-head-watcher-failed', diag);
        } catch {
          /* sender gone */
        }
      };

      let handle: GitHeadWatcher;
      try {
        handle = await watchRepoHead(repoRoot, {
          onChange: sendChange,
          onDiagnostic: sendDiagnostic,
        });
      } catch {
        return { ok: false };
      }
      // Re-check the registry AFTER the awaits above: two rapid calls
      // (React StrictMode double-effect, fast re-renders) both pass the
      // `has()` check at the top, and without this the second `set()`
      // would overwrite the first handle — leaking a live fs.watch that
      // fires duplicate `git rev-parse` probes forever with no way to
      // dispose it.
      if (headWatchers.has(key)) {
        handle.dispose();
        return { ok: true };
      }
      headWatchers.set(key, handle);
      rememberWatcherForSender(senderId, key);

      // Tie lifecycle to the sender so a window-close cleans up.
      // Electron's `destroyed` event fires synchronously during
      // close, so we don't need an additional `before-quit` hook.
      // Install the listener AT MOST ONCE per sender id (reviewer
      // pass — previously every `watch-head` call on a different
      // repoRoot would queue another listener).
      if (!destroyedListenerInstalled.has(senderId)) {
        destroyedListenerInstalled.add(senderId);
        sender.once('destroyed', () => {
          destroyedListenerInstalled.delete(senderId);
          disposeAllForSender(senderId);
        });
      }
      return { ok: true };
    }
  );

  // RL-102 Slice 2 — stop a HEAD watcher. Idempotent on a missing
  // key; the renderer hook calls this on every cleanup pass.
  ipcMain.handle(
    'git:unwatch-head',
    async (event, rawRepoRoot: unknown): Promise<{ ok: boolean }> => {
      if (typeof rawRepoRoot !== 'string' || rawRepoRoot.length === 0) {
        return { ok: false };
      }
      const senderId = event.sender.id;
      const key = watcherKey(senderId, rawRepoRoot);
      disposeWatcher(key);
      forgetWatcherForSender(senderId, key);
      return { ok: true };
    }
  );
}

/**
 * Test seam — drop all watchers + per-sender bookkeeping. Used by
 * the IPC test suite to keep cases isolated.
 */
export function _resetGitHeadWatchersForTests(): void {
  for (const [key] of headWatchers) disposeWatcher(key);
  headWatchers.clear();
  watchersBySender.clear();
  destroyedListenerInstalled.clear();
}

// Re-export the broadcast channel names so the renderer-side
// constants do not drift from the main-side wire format.
export const GIT_HEAD_CHANGED_CHANNEL = 'git:on-head-changed';
export const GIT_HEAD_WATCHER_FAILED_CHANNEL = 'git:on-head-watcher-failed';

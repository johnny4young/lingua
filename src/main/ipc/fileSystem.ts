/**
 * File system IPC handlers for the main process.
 *
 * RL-077 capability-based sandbox: every renderer-facing operation
 * goes through `resolveCapabilityPath` so absolute paths cannot leak
 * across the IPC boundary. Pickers mint a capability for the chosen
 * root (or the parent directory of a single chosen file); subsequent
 * operations supply `{ rootId, relativePath }` and main canonicalizes,
 * `realpath`-resolves, and verifies containment before any disk I/O.
 *
 * The denylist (`isPathBlocked`) stays as defense-in-depth — applied
 * inside `resolveCapabilityPath` against the resolved absolute path —
 * so a project root that itself overlaps a sensitive directory still
 * rejects writes.
 */

import { dialog, BrowserWindow, app, shell } from 'electron';
import { typedHandle } from './typedHandle';
import { registerSearchReplaceHandlers } from './fs/fsSearchReplace';
import { registerBundleHandlers } from './fs/fsBundle';
import {
  CapabilityError,
  dirnameRelative,
  joinRelative,
  resolveOrThrow,
  shouldHide,
} from './fs/fsShared';
import {
  mkdir as mkdirFs,
  readFile,
  readdir,
  rename as renameFs,
  rm,
  stat as statAsync,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { watch } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { OPEN_FILE_FILTERS } from '../../shared/filePickerTypes';
import { translateCommon } from '../../shared/i18n/runtime';
import {
  buildWatcherDiagnostic,
  type WatcherDiagnostic,
} from '../../shared/fs/watcherDiagnostic';
import {
  blockedPathFamily,
  isPathBlocked,
  isPathWithinProject,
  isSafeEntryName,
  registerBlockedPaths,
} from './permissions';
import {
  mintFileCapability,
  mintRootCapability,
  resolveCapabilityPath,
  revokeRoot,
  type RootId,
} from './projectCapabilities';
import {
  asRelativePath,
  asWatchId,
  type RelativePath,
  type WatchId,
} from '../../shared/fs/brandedIds';

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

interface FilesystemApprovalsFile {
  version: 1;
  roots: string[];
  files: string[];
}

const FILESYSTEM_APPROVALS_FILENAME = 'filesystem-approvals.json';

// Approval persistence is only a convenience layer for recent projects/files.
// Authority still comes from minting a fresh process-local rootId and routing
// every later operation through resolveCapabilityPath.
let filesystemApprovalsLoaded = false;
let approvedRoots = new Set<string>();
let approvedFiles = new Set<string>();

function normalizeApprovalPath(absolutePath: string): string {
  return path.normalize(path.resolve(absolutePath));
}

function approvalsFilePath(): string | null {
  if (typeof app?.getPath !== 'function') return null;
  try {
    return path.join(app.getPath('userData'), FILESYSTEM_APPROVALS_FILENAME);
  } catch {
    return null;
  }
}

async function loadFilesystemApprovals(): Promise<void> {
  if (filesystemApprovalsLoaded) return;
  filesystemApprovalsLoaded = true;
  const filePath = approvalsFilePath();
  if (!filePath) return;

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FilesystemApprovalsFile>;
    if (parsed.version !== 1) return;
    approvedRoots = new Set(
      (parsed.roots ?? [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeApprovalPath)
    );
    approvedFiles = new Set(
      (parsed.files ?? [])
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeApprovalPath)
    );
  } catch {
    // Missing or corrupt approval state should degrade to prompting the
    // user again, not to reopening arbitrary paths.
  }
}

async function persistFilesystemApprovals(): Promise<void> {
  const filePath = approvalsFilePath();
  if (!filePath) return;
  try {
    await mkdirFs(path.dirname(filePath), { recursive: true });
    const payload: FilesystemApprovalsFile = {
      version: 1,
      roots: [...approvedRoots].sort(),
      files: [...approvedFiles].sort(),
    };
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch {
    // Persistence is convenience, not authority. The current process
    // still keeps the approval; the next boot will require a fresh pick.
  }
}

async function rememberApprovedRoot(absolutePath: string): Promise<void> {
  await loadFilesystemApprovals();
  approvedRoots.add(normalizeApprovalPath(absolutePath));
  await persistFilesystemApprovals();
}

async function rememberApprovedFile(absolutePath: string): Promise<void> {
  await loadFilesystemApprovals();
  approvedFiles.add(normalizeApprovalPath(absolutePath));
  await persistFilesystemApprovals();
}

async function hasApprovedRoot(absolutePath: string): Promise<boolean> {
  await loadFilesystemApprovals();
  return approvedRoots.has(normalizeApprovalPath(absolutePath));
}

async function hasApprovedFile(absolutePath: string): Promise<boolean> {
  await loadFilesystemApprovals();
  const normalized = normalizeApprovalPath(absolutePath);
  if (approvedFiles.has(normalized)) return true;
  // Files under an approved project root can be reopened individually for
  // recent-file/session restore flows without approving every child file.
  for (const root of approvedRoots) {
    if (isPathWithinProject(normalized, root)) return true;
  }
  return false;
}

/**
 * True when `absolutePath` intersects the user-approved filesystem scope:
 * it IS an approved root (or exactly an approved file), lives INSIDE an
 * approved root, or is an ANCESTOR of an approved root. The ancestor arm
 * exists for the git read-only layer, where the repository toplevel of an
 * approved project subfolder legitimately sits ABOVE the approved root
 * (monorepo case: project opened at repo/packages/app, repoRoot = repo).
 *
 * Read-only consumers outside the rootId capability system (the git:*
 * handlers) gate on this so a compromised renderer cannot point them at
 * arbitrary disk locations — closing the one IPC door that previously
 * accepted raw absolute paths with no approval check, and aligning git
 * with the RL-077 defense-in-depth posture.
 */
export async function pathIntersectsApprovedScope(
  absolutePath: string
): Promise<boolean> {
  await loadFilesystemApprovals();
  const normalized = normalizeApprovalPath(absolutePath);
  if (approvedRoots.has(normalized) || approvedFiles.has(normalized)) {
    return true;
  }
  for (const root of approvedRoots) {
    // Inside an approved root, or an ancestor of one. Intentionally NOT
    // widened to ancestors of approved single files: the git layer only
    // ever operates on project roots, and narrower is safer.
    if (isPathWithinProject(normalized, root)) return true;
    if (isPathWithinProject(root, normalized)) return true;
  }
  return false;
}

/**
 * Stricter, containment-only variant of `pathIntersectsApprovedScope` for
 * consumers that read FILE CONTENTS off disk (git:status / git:diff). The
 * path must BE an approved root/file or live INSIDE an approved root. The
 * ancestor arm is intentionally absent: a repo toplevel sitting above the
 * approved project is a legitimate repoRoot argument, but being an ancestor
 * must never be enough to read arbitrary sibling files outside the approved
 * subtree (unversioned monorepo secrets included).
 */
export async function pathInsideApprovedScope(
  absolutePath: string
): Promise<boolean> {
  await loadFilesystemApprovals();
  const normalized = normalizeApprovalPath(absolutePath);
  if (approvedRoots.has(normalized) || approvedFiles.has(normalized)) {
    return true;
  }
  for (const root of approvedRoots) {
    if (isPathWithinProject(normalized, root)) return true;
  }
  return false;
}

export function _resetFilesystemApprovalsForTests(): void {
  filesystemApprovalsLoaded = false;
  approvedRoots = new Set();
  approvedFiles = new Set();
}

/**
 * Directories and files to filter out of the file tree.
 * Keeps the tree clean and avoids exposing build artifacts or VCS internals.
 */
// IT2-A1 — HIDDEN_ENTRIES / EMPTY_DIR_IGNORE / shouldHide / joinRelative /
// dirnameRelative / isRecord / coerceBundleBytes / coercePositiveLimit /
// CapabilityError / resolveOrThrow moved VERBATIM to ./fs/fsShared.
// searchInFiles/replaceInFiles/applyReplaceInFile moved to ./fs/fsSearchReplace;
// exportBundle/importBundle moved to ./fs/fsBundle. This file stays the
// assembly: pickers, dialogs, read/write ops, watchers, and approval state.

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

export function registerFileSystemHandlers(): void {
  // RL-087 — install the `before-quit` listener so watchers do not
  // outlive the process. Idempotent; safe to call across hot-reload.
  ensureBeforeQuitCleanup();

  // RL-137 / AUDIT-17 — block renderer-initiated reads/writes into Lingua's own
  // electron-owned data dirs (userData / sessionData / logs). Resolved from
  // `app` at startup rather than guessed from the app name, so the denylist
  // matches the real on-disk paths on every OS. Idempotent across hot-reload.
  registerBlockedPaths(
    (['userData', 'sessionData', 'logs'] as const).flatMap((name) => {
      try {
        return [app.getPath(name)];
      } catch {
        return [];
      }
    })
  );

  const t = (
    language: string | undefined,
    key: string,
    options?: Record<string, unknown>
  ) => translateCommon(language ?? 'en', key, options);

  const assertSafeEntryName = (name: string, operation: string) => {
    if (!isSafeEntryName(name)) {
      throw new Error(`Invalid ${operation}: "${name}"`);
    }
  };

  // ---------------------------------------------------------------- pickers

  typedHandle('fs:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } as const;
    }
    const chosen = result.filePaths[0]!;
    const blockedFamily = blockedPathFamily(chosen);
    if (blockedFamily) {
      return { canceled: true, blockedFamily } as const;
    }
    const { rootId, rootPath } = mintRootCapability(chosen);
    await rememberApprovedRoot(chosen);
    return { canceled: false, rootId, rootPath } as const;
  });

  typedHandle('fs:select-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: OPEN_FILE_FILTERS.map((filter) => ({
        name: filter.name,
        extensions: [...filter.extensions],
      })),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } as const;
    }
    const chosen = result.filePaths[0]!;
    const blockedFamily = blockedPathFamily(chosen);
    if (blockedFamily) {
      return { canceled: true, blockedFamily } as const;
    }
    const { rootId, rootPath, fileRelativePath } = mintFileCapability(chosen);
    // Atomic read while we hold the freshly minted capability so the
    // renderer never has to make a second IPC call against an absolute
    // path it does not own.
    const resolution = await resolveCapabilityPath(rootId, fileRelativePath, 'read');
    if (!resolution.ok) {
      revokeRoot(rootId);
      throw new CapabilityError(resolution.error);
    }
    let content: string;
    try {
      content = await readFile(resolution.absolutePath, 'utf-8');
    } catch (error) {
      revokeRoot(rootId);
      throw error;
    }
    await rememberApprovedFile(chosen);
    return {
      canceled: false,
      rootId,
      rootPath,
      fileRelativePath,
      content,
      fileName: fileRelativePath,
    } as const;
  });

  typedHandle(
    'fs:save-dialog',
    async (_event, defaultName: string, defaultDir?: string) => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultDir
          ? path.join(defaultDir, defaultName)
          : defaultName,
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true } as const;
      }
      const blockedFamily = blockedPathFamily(result.filePath);
      if (blockedFamily) {
        return { canceled: true, blockedFamily } as const;
      }
      const { rootId, rootPath, fileRelativePath } = mintFileCapability(result.filePath);
      await rememberApprovedFile(result.filePath);
      return { canceled: false, rootId, rootPath, fileRelativePath } as const;
    }
  );

  // RL-137 / AUDIT-17 — read-only classification so the renderer can show an
  // actionable, localized denial (and a privacy-safe `fs.blocked` telemetry
  // signal that names only the family, never the path) when a reopen or pick is
  // refused by the denylist. Mints no capability; performs no disk write.
  typedHandle('fs:classify-blocked-path', (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
      return { family: null } as const;
    }
    return { family: blockedPathFamily(absolutePath) } as const;
  });

  // ---------------------------------------------------------------- root mgmt

  /**
   * Re-mint a capability for an absolute root path main has previously
   * recorded from a native directory picker. The
   * path is denylist-checked and stat-probed so a stale entry that no
   * longer resolves on disk fails loudly instead of silently minting a
   * token that subsequent operations would reject anyway.
   */
  typedHandle('fs:reopen-root', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
      return { ok: false, error: 'not-found' } as const;
    }
    if (isPathBlocked(absolutePath, 'read')) {
      return { ok: false, error: 'blocked' } as const;
    }
    if (!(await hasApprovedRoot(absolutePath))) {
      return { ok: false, error: 'not-approved' } as const;
    }
    // `stat` already throws ENOENT / ENOTDIR on missing paths, so a
    // separate `access` round-trip only widens the TOCTOU window with
    // no extra signal. One probe is enough.
    let info;
    try {
      info = await statAsync(absolutePath);
    } catch {
      return { ok: false, error: 'not-found' } as const;
    }
    if (!info.isDirectory()) {
      return { ok: false, error: 'not-a-directory' } as const;
    }
    const { rootId, rootPath } = mintRootCapability(absolutePath);
    const verification = await resolveCapabilityPath(rootId, '', 'read');
    if (!verification.ok) {
      revokeRoot(rootId);
      return {
        ok: false,
        error: verification.error === 'blocked-path' ? 'blocked' : 'not-found',
      } as const;
    }
    return { ok: true, rootId, rootPath } as const;
  });

  /**
   * Re-mint a single-file capability for a file main has previously
   * recorded from a native file/save picker, or for a file inside a
   * previously approved project root. This keeps saved tabs/recent
   * files ergonomic without reopening a whole parent directory.
   */
  typedHandle('fs:reopen-file', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
      return { ok: false, error: 'not-found' } as const;
    }
    if (isPathBlocked(absolutePath, 'read')) {
      return { ok: false, error: 'blocked' } as const;
    }
    if (!(await hasApprovedFile(absolutePath))) {
      return { ok: false, error: 'not-approved' } as const;
    }

    let info;
    try {
      info = await statAsync(absolutePath);
    } catch {
      return { ok: false, error: 'not-found' } as const;
    }
    if (!info.isFile()) {
      return { ok: false, error: 'not-a-file' } as const;
    }

    const { rootId, rootPath, fileRelativePath } = mintFileCapability(absolutePath);
    const verification = await resolveCapabilityPath(rootId, fileRelativePath, 'read');
    if (!verification.ok) {
      revokeRoot(rootId);
      return {
        ok: false,
        error: verification.error === 'blocked-path' ? 'blocked' : 'not-found',
      } as const;
    }
    return { ok: true, rootId, rootPath, fileRelativePath } as const;
  });

  typedHandle('fs:revoke-root', (_event, rootId: RootId) => {
    return revokeRoot(rootId);
  });

  // ------------------------------------------------------- close confirmations

  typedHandle(
    'app:confirm-close',
    async (event, dirtyFileNames: string[], language?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const { response } = await dialog.showMessageBox(win!, {
        type: 'question',
        buttons: [
          t(language, 'dialogs.actions.saveAll'),
          t(language, 'dialogs.actions.discard'),
          t(language, 'dialogs.actions.cancel'),
        ],
        defaultId: 0,
        cancelId: 2,
        title: t(language, 'dialogs.closeApp.title'),
        message: t(language, 'dialogs.closeApp.message', { count: dirtyFileNames.length }),
        detail: dirtyFileNames.join(', '),
      });
      return response;
    }
  );

  typedHandle(
    'app:confirm-close-tab',
    async (event, fileName: string, language?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const { response } = await dialog.showMessageBox(win!, {
        type: 'question',
        buttons: [
          t(language, 'dialogs.actions.save'),
          t(language, 'dialogs.actions.discard'),
          t(language, 'dialogs.actions.cancel'),
        ],
        defaultId: 0,
        cancelId: 2,
        title: t(language, 'dialogs.closeTab.title'),
        message: t(language, 'dialogs.closeTab.message', { name: fileName }),
        detail: t(language, 'dialogs.closeTab.detail'),
      });
      return response;
    }
  );

  // --------------------------------------------------------------- readdir

  typedHandle(
    'fs:readdir',
    async (_event, rootId: RootId, relativePath: string) => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );
      const entries = await readdir(absolutePath, { withFileTypes: true });
      return entries
        .filter((e) => !shouldHide(e.name))
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        })
        .map((e) => {
          return {
            name: e.name,
            isDirectory: e.isDirectory(),
            relativePath: asRelativePath(joinRelative(relativePath, e.name)),
          };
        });
    }
  );

  // ------------------------------------------------------ listAllFiles (index)

  /**
   * Recursively walk the resolved capability path and return every visible
   * file entry. Used by Quick Open to index the project — only file leaves
   * are returned. Directories themselves are omitted; symlinks/non-regular
   * entries are skipped to avoid cycles. Total result size is capped so a
   * pathological project cannot starve the IPC channel.
   */
  typedHandle(
    'fs:listAllFiles',
    async (
      _event,
      rootId: RootId,
      relativePath: string = ''
    ): Promise<FsIndexedFile[]> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );

      const MAX_FILES = 20_000;
      const results: FsIndexedFile[] = [];

      async function walk(dirPath: string, currentRelative: string) {
        if (results.length >= MAX_FILES) return;

        let entries;
        try {
          entries = await readdir(dirPath, { withFileTypes: true });
        } catch {
          // Unreadable directories (permissions, races) are skipped silently —
          // the index is best-effort and individual failures should not abort
          // the whole walk.
          return;
        }

        for (const entry of entries) {
          if (results.length >= MAX_FILES) return;
          if (shouldHide(entry.name)) continue;

          const entryPath = path.join(dirPath, entry.name);
          const entryRelative = joinRelative(currentRelative, entry.name);

          if (entry.isDirectory()) {
            await walk(entryPath, entryRelative);
            continue;
          }

          if (!entry.isFile()) continue; // skip symlinks, sockets, etc.

          results.push({
            name: entry.name,
            relativePath: asRelativePath(entryRelative),
          });
        }
      }

      await walk(absolutePath, relativePath);
      return results;
    }
  );

  registerSearchReplaceHandlers();

  // ------------------------------------------------------------------ stat

  typedHandle('fs:stat', async (_event, rootId: RootId, relativePath: string) => {
    const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'read');
    const s = await statAsync(absolutePath);
    return {
      size: s.size,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      mtime: s.mtime.toISOString(),
      ctime: s.ctime.toISOString(),
    };
  });

  // ------------------------------------------------------------------ read

  typedHandle('fs:read', async (_event, rootId: RootId, relativePath: string) => {
    const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'read');
    return readFile(absolutePath, 'utf-8');
  });

  // ----------------------------------------------------------------- write

  typedHandle(
    'fs:write',
    async (_event, rootId: RootId, relativePath: string, content: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'write');
      await writeFile(absolutePath, content, 'utf-8');
      return true;
    }
  );

  // ---------------------------------------------------------------- delete

  typedHandle(
    'fs:delete',
    async (
      event,
      rootId: RootId,
      relativePath: string,
      isDirectory = false,
      language?: string
    ) => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'delete'
      );

      // Security hardening — the renderer uses the shared ConfirmDialog
      // for the web FSA adapter, but desktop deletes must still enforce the
      // confirmation inside main. The IPC bridge is the trust boundary for
      // host-file mutations; a compromised or buggy renderer must not be
      // able to invoke fs:delete without a main-owned user prompt.
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        type: 'warning' as const,
        buttons: [
          t(language, 'dialogs.actions.delete'),
          t(language, 'dialogs.actions.cancel'),
        ],
        defaultId: 1,
        cancelId: 1,
        title: t(language, 'dialogs.delete.title'),
        message: t(language, 'dialogs.delete.message', {
          name: path.basename(absolutePath),
        }),
        detail: isDirectory
          ? t(language, 'dialogs.delete.detail.directory')
          : t(language, 'dialogs.delete.detail.file'),
      };
      const { response } = win
        ? await dialog.showMessageBox(win, dialogOptions)
        : await dialog.showMessageBox(dialogOptions);

      if (response !== 0) return false; // user cancelled

      if (isDirectory) {
        await rm(absolutePath, { recursive: true, force: true });
      } else {
        await unlink(absolutePath);
      }
      return true;
    }
  );

  // ---------------------------------------------------------------- rename

  typedHandle(
    'fs:rename',
    async (_event, rootId: RootId, relativeOldPath: string, newName: string) => {
      assertSafeEntryName(newName, 'name for rename');
      const { absolutePath: oldAbsolute } = await resolveOrThrow(
        rootId,
        relativeOldPath,
        'write'
      );
      const newAbsolute = path.join(path.dirname(oldAbsolute), newName);
      // Re-resolve the new path through the registry to verify it still
      // sits inside the approved root after the rename, and that it is
      // not denylisted.
      const newRelative = joinRelative(dirnameRelative(relativeOldPath), newName);
      const verify = await resolveCapabilityPath(rootId, newRelative, 'write');
      if (!verify.ok) {
        throw new CapabilityError(verify.error);
      }
      await renameFs(oldAbsolute, newAbsolute);
      return asRelativePath(newRelative);
    }
  );

  // ----------------------------------------------------------------- mkdir

  typedHandle(
    'fs:mkdir',
    async (_event, rootId: RootId, relativePath: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'write');
      await mkdirFs(absolutePath, { recursive: true });
      return true;
    }
  );

  // ----------------------------------------------------------------- touch (create empty file)

  typedHandle(
    'fs:touch',
    async (_event, rootId: RootId, relativePath: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'write');
      await writeFile(absolutePath, '', 'utf-8');
      return true;
    }
  );

  // ---------------------------------------------------------- reveal in OS finder

  // RL-024 Slice 1 fold A — open the OS file manager (Finder /
  // Explorer / Nautilus) with the entry selected. Resolves the
  // capability so an attacker-controlled `relativePath` can never
  // escape the project root. `shell.showItemInFolder` is a synchronous
  // best-effort call — it returns void and silently no-ops if the
  // path does not exist, so a stale tree refresh request from the
  // renderer can't be turned into an information-disclosure side
  // channel. We resolve with `'read'` permission because we are not
  // writing anything; the read denylist still applies.
  typedHandle(
    'fs:reveal-in-finder',
    async (_event, rootId: RootId, relativePath: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'read');
      // RL-024 Slice 1 fold A — `shell.showItemInFolder` is a void
      // best-effort call that silently no-ops when the entry no
      // longer exists. A small TOCTOU window remains (`stat` →
      // `showItemInFolder`), but probing here lets the renderer
      // distinguish "opened" from "stale tree" and skip a
      // misleading success affordance. Missing-path returns `false`
      // instead of throwing so the renderer can gracefully fall
      // back without a try/catch.
      try {
        await statAsync(absolutePath);
      } catch {
        return false;
      }
      shell.showItemInFolder(absolutePath);
      return true;
    }
  );

  registerBundleHandlers(rememberApprovedRoot);

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

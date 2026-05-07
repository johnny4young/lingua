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

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
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
import { isPathBlocked, isSafeEntryName } from './permissions';
import {
  mintRootCapability,
  resolveCapabilityPath,
  revokeRoot,
  type CapabilityResolution,
  type RootId,
} from './projectCapabilities';

/**
 * Active file system watchers keyed by an opaque watchId. Only main
 * retains the rootId + absolute watched path mapping; the renderer gets
 * an unstructured token it can pass back to stop the watcher.
 */
interface WatcherEntry {
  rootId: RootId;
  watchedPath: string;
  targetKey: string;
  stop: () => void;
}

const watchers = new Map<string, WatcherEntry>();
const watcherIdsByTarget = new Map<string, string>();

/**
 * Directories and files to filter out of the file tree.
 * Keeps the tree clean and avoids exposing build artifacts or VCS internals.
 */
const HIDDEN_ENTRIES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'target', // Rust build output
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
]);

function shouldHide(name: string): boolean {
  if (HIDDEN_ENTRIES.has(name)) return true;
  // Hide all dotfiles except a few useful ones
  if (name.startsWith('.') && name !== '.env' && name !== '.gitignore') {
    return true;
  }
  return false;
}

function joinRelative(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

/**
 * Compute the parent of a relative path using only `/` separators.
 * Renderer-supplied relative paths can mix `\` and `/` (Windows
 * persistence rehydrating on POSIX, etc.); using `path.dirname` here
 * would honor the host OS separator and break those mixed strings.
 */
function dirnameRelative(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

class CapabilityError extends Error {
  constructor(
    public readonly code: NonNullable<
      Extract<CapabilityResolution, { ok: false }>
    >['error']
  ) {
    super(`Filesystem capability error: ${code}`);
  }
}

async function resolveOrThrow(
  rootId: unknown,
  relativePath: unknown,
  operation: 'read' | 'write' | 'delete'
): Promise<{ absolutePath: string; rootPath: string }> {
  const resolution = await resolveCapabilityPath(rootId, relativePath, operation);
  if (!resolution.ok) {
    throw new CapabilityError(resolution.error);
  }
  return { absolutePath: resolution.absolutePath, rootPath: resolution.rootPath };
}

function stopWatcherById(watchId: string): boolean {
  const entry = watchers.get(watchId);
  if (!entry) return false;
  entry.stop();
  watchers.delete(watchId);
  watcherIdsByTarget.delete(entry.targetKey);
  // RL-087 — drop the per-watcher burst tracker entry so a long
  // session that opens + closes many projects under inotify load
  // does not accumulate dead UUIDs in the map.
  nullFilenameBursts.delete(watchId);
  return true;
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
const nullFilenameBursts = new Map<string, NullFilenameBurst>();

function recordNullFilenameBurst(watchId: string): boolean {
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

  ipcMain.handle('fs:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } as const;
    }
    const chosen = result.filePaths[0]!;
    if (isPathBlocked(chosen, 'read')) {
      throw new Error(`Access denied: cannot open protected path: ${chosen}`);
    }
    const { rootId, rootPath } = mintRootCapability(chosen);
    return { canceled: false, rootId, rootPath } as const;
  });

  ipcMain.handle('fs:select-file', async () => {
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
    if (isPathBlocked(chosen, 'read')) {
      throw new Error(`Access denied: cannot read protected path: ${chosen}`);
    }
    const parent = path.dirname(chosen);
    const fileRelativePath = path.basename(chosen);
    const { rootId, rootPath } = mintRootCapability(parent);
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
    return {
      canceled: false,
      rootId,
      rootPath,
      fileRelativePath,
      content,
      fileName: fileRelativePath,
    } as const;
  });

  ipcMain.handle(
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
      if (isPathBlocked(result.filePath, 'write')) {
        throw new Error(
          `Access denied: cannot save to protected path: ${result.filePath}`
        );
      }
      const parent = path.dirname(result.filePath);
      const fileRelativePath = path.basename(result.filePath);
      const { rootId, rootPath } = mintRootCapability(parent);
      return { canceled: false, rootId, rootPath, fileRelativePath } as const;
    }
  );

  // ---------------------------------------------------------------- root mgmt

  /**
   * Re-mint a capability for an absolute root path the user previously
   * approved (typically the persisted `currentProject.rootPath` in the
   * renderer's project store, or a saved tab's parent directory). The
   * path is denylist-checked and stat-probed so a stale entry that no
   * longer resolves on disk fails loudly instead of silently minting a
   * token that subsequent operations would reject anyway.
   */
  ipcMain.handle('fs:reopen-root', async (_event, absolutePath: string) => {
    if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
      return { ok: false, error: 'not-found' } as const;
    }
    if (isPathBlocked(absolutePath, 'read')) {
      return { ok: false, error: 'blocked' } as const;
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

  ipcMain.handle('fs:revoke-root', (_event, rootId: RootId) => {
    return revokeRoot(rootId);
  });

  // ------------------------------------------------------- close confirmations

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
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
            relativePath: joinRelative(relativePath, e.name),
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
  ipcMain.handle(
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
            relativePath: entryRelative,
          });
        }
      }

      await walk(absolutePath, relativePath);
      return results;
    }
  );

  // -------------------------------------------------- searchInFiles (text)

  /**
   * Plain-text substring search across every visible file in the project.
   * Capability-resolved root + relative path, same hidden-entry filter,
   * binary skip, size budget, and per-file / total match caps as before.
   */
  ipcMain.handle(
    'fs:searchInFiles',
    async (
      _event,
      rootId: RootId,
      relativePath: string,
      query: string,
      options: FsSearchOptions = {}
    ): Promise<FsSearchResult[]> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );

      const trimmedQuery = query ?? '';
      if (trimmedQuery.length === 0) return [];

      const caseSensitive = options.caseSensitive ?? false;
      const maxMatchesPerFile = Math.max(1, options.maxMatchesPerFile ?? 20);
      const maxTotalMatches = Math.max(1, options.maxTotalMatches ?? 500);
      const maxFileSize = Math.max(1, options.maxFileSize ?? 1_000_000);
      const maxFilesScanned = Math.max(1, options.maxFilesScanned ?? 5_000);

      const needle = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
      const results: FsSearchResult[] = [];
      let totalMatches = 0;
      let filesScanned = 0;

      const NUL = String.fromCharCode(0);
      function looksBinary(text: string): boolean {
        const probe = text.slice(0, 1024);
        return probe.includes(NUL);
      }

      async function searchFile(filePath: string, fileRelativePath: string) {
        if (totalMatches >= maxTotalMatches) return;

        let info;
        try {
          info = await statAsync(filePath);
        } catch {
          return; // missing/unreadable file — best-effort
        }

        if (!info.isFile() || info.size > maxFileSize) return;

        let content: string;
        try {
          content = await readFile(filePath, 'utf8');
        } catch {
          return;
        }

        if (looksBinary(content)) return;

        const fileMatches: FsSearchMatch[] = [];
        const lines = content.split(/\r?\n/);

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          if (fileMatches.length >= maxMatchesPerFile) break;
          if (totalMatches + fileMatches.length >= maxTotalMatches) break;

          const rawLine = lines[lineIndex]!;
          const haystack = caseSensitive ? rawLine : rawLine.toLowerCase();
          const column = haystack.indexOf(needle);
          if (column === -1) continue;

          const PREVIEW_BUDGET = 240;
          const previewStart = Math.max(0, column - 80);
          const previewEnd = Math.min(rawLine.length, previewStart + PREVIEW_BUDGET);
          const preview = rawLine.slice(previewStart, previewEnd);

          fileMatches.push({
            line: lineIndex + 1,
            column: column + 1,
            preview,
            matchStart: column - previewStart,
            matchEnd: column - previewStart + trimmedQuery.length,
          });
        }

        if (fileMatches.length > 0) {
          results.push({
            relativePath: fileRelativePath,
            matches: fileMatches,
          });
          totalMatches += fileMatches.length;
        }
      }

      async function walk(dirPath: string, currentRelative: string) {
        if (totalMatches >= maxTotalMatches || filesScanned >= maxFilesScanned) {
          return;
        }

        let entries;
        try {
          entries = await readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (totalMatches >= maxTotalMatches || filesScanned >= maxFilesScanned) {
            return;
          }
          if (shouldHide(entry.name)) continue;

          const entryPath = path.join(dirPath, entry.name);
          const entryRelative = joinRelative(currentRelative, entry.name);

          if (entry.isDirectory()) {
            await walk(entryPath, entryRelative);
            continue;
          }

          if (!entry.isFile()) continue;

          filesScanned += 1;
          await searchFile(entryPath, entryRelative);
        }
      }

      await walk(absolutePath, relativePath);
      return results;
    }
  );

  // ------------------------------------------------------------------ stat

  ipcMain.handle('fs:stat', async (_event, rootId: RootId, relativePath: string) => {
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

  ipcMain.handle('fs:read', async (_event, rootId: RootId, relativePath: string) => {
    const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'read');
    return readFile(absolutePath, 'utf-8');
  });

  // ----------------------------------------------------------------- write

  ipcMain.handle(
    'fs:write',
    async (_event, rootId: RootId, relativePath: string, content: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'write');
      await writeFile(absolutePath, content, 'utf-8');
      return true;
    }
  );

  // ---------------------------------------------------------------- delete

  ipcMain.handle(
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

      const win = BrowserWindow.fromWebContents(event.sender);
      const { response } = await dialog.showMessageBox(win!, {
        type: 'warning',
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
      });

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

  ipcMain.handle(
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
      return newRelative;
    }
  );

  // ----------------------------------------------------------------- mkdir

  ipcMain.handle(
    'fs:mkdir',
    async (_event, rootId: RootId, relativePath: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'write');
      await mkdirFs(absolutePath, { recursive: true });
      return true;
    }
  );

  // ----------------------------------------------------------------- touch (create empty file)

  ipcMain.handle(
    'fs:touch',
    async (_event, rootId: RootId, relativePath: string) => {
      const { absolutePath } = await resolveOrThrow(rootId, relativePath, 'write');
      await writeFile(absolutePath, '', 'utf-8');
      return true;
    }
  );

  // --------------------------------------------------------------- watch

  ipcMain.handle(
    'fs:watch-start',
    async (event, rootId: RootId, relativePath: string = '') => {
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
      const watchId = randomUUID();

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
            const eventRelative = joinRelative(relativePath, fileName);
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

      watchers.set(watchId, {
        rootId,
        watchedPath: absolutePath,
        targetKey,
        stop: () => watcher.close(),
      });
      watcherIdsByTarget.set(targetKey, watchId);
      return watchId;
    }
  );

  ipcMain.handle('fs:watch-stop', (_event, watchId: string) => {
    stopWatcherById(watchId);
    return true;
  });
}

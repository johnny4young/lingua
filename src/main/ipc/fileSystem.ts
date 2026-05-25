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

import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron';
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
import { isPathBlocked, isPathWithinProject, isSafeEntryName } from './permissions';
import {
  mintFileCapability,
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

interface FilesystemApprovalsFile {
  version: 1;
  roots: string[];
  files: string[];
}

const FILESYSTEM_APPROVALS_FILENAME = 'filesystem-approvals.json';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coercePositiveLimit(
  value: unknown,
  fallback: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
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
    await rememberApprovedRoot(chosen);
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
      const { rootId, rootPath, fileRelativePath } = mintFileCapability(result.filePath);
      await rememberApprovedFile(result.filePath);
      return { canceled: false, rootId, rootPath, fileRelativePath } as const;
    }
  );

  // ---------------------------------------------------------------- root mgmt

  /**
   * Re-mint a capability for an absolute root path main has previously
   * recorded from a native directory picker. The
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
  ipcMain.handle('fs:reopen-file', async (_event, absolutePath: string) => {
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

      if (typeof query !== 'string') return [];
      const safeOptions = isRecord(options) ? options : {};
      const searchText = query;
      if (searchText.length === 0) return [];

      const caseSensitive = safeOptions.caseSensitive === true;
      const maxMatchesPerFile = coercePositiveLimit(
        safeOptions.maxMatchesPerFile,
        20,
        200
      );
      const maxTotalMatches = coercePositiveLimit(
        safeOptions.maxTotalMatches,
        500,
        5_000
      );
      const maxFileSize = coercePositiveLimit(
        safeOptions.maxFileSize,
        1_000_000,
        1_000_000
      );
      const maxFilesScanned = coercePositiveLimit(
        safeOptions.maxFilesScanned,
        5_000,
        20_000
      );

      const needle = caseSensitive ? searchText : searchText.toLowerCase();
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
            matchEnd: column - previewStart + searchText.length,
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

  // -------------------------------------------------- replaceInFiles
  //
  // RL-024 Slice 2 — preview + atomic-apply of literal-or-regex
  // substitutions across project files. The preview path reuses the
  // search walker shape; the apply path writes via a same-directory
  // tmpfile + `fs.rename` (Windows AV retry x3). Closed-enum failure
  // reasons surface through the renderer panel's confirmation modal.

  function buildSearchRegex(
    query: string,
    options: Record<string, unknown>
  ): RegExp | null {
    const flags = `g${options.caseSensitive === true ? '' : 'i'}`;
    try {
      return options.regex === true
        ? new RegExp(query, flags)
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return null;
    }
  }

  function replacementForMatch(
    matchedText: string,
    singleMatchRegex: RegExp,
    replacement: string,
    regexMode: boolean
  ): string {
    return regexMode
      ? matchedText.replace(singleMatchRegex, replacement)
      : replacement;
  }

  function replaceAllMatches(
    content: string,
    re: RegExp,
    replacement: string,
    regexMode: boolean
  ): string {
    if (regexMode) {
      return content.replace(re, replacement);
    }
    return content.replace(re, () => replacement);
  }

  async function walkProject(
    rootAbsolutePath: string,
    rootRelativePath: string,
    onFile: (
      absolutePath: string,
      relativePath: string
    ) => Promise<boolean | void>,
    maxFilesScanned: number
  ): Promise<void> {
    let filesScanned = 0;
    async function walk(
      dirPath: string,
      currentRelative: string
    ): Promise<boolean> {
      if (filesScanned >= maxFilesScanned) return false;
      let entries;
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch {
        return true;
      }
      for (const entry of entries) {
        if (filesScanned >= maxFilesScanned) return false;
        if (shouldHide(entry.name)) continue;
        const entryPath = path.join(dirPath, entry.name);
        const entryRelative = joinRelative(currentRelative, entry.name);
        if (entry.isDirectory()) {
          const cont = await walk(entryPath, entryRelative);
          if (!cont) return false;
          continue;
        }
        if (!entry.isFile()) continue;
        filesScanned += 1;
        const cont = await onFile(entryPath, entryRelative);
        if (cont === false) return false;
      }
      return true;
    }
    await walk(rootAbsolutePath, rootRelativePath);
  }

  ipcMain.handle(
    'fs:replaceInFiles',
    async (
      _event,
      rootId: RootId,
      relativePath: string,
      query: string,
      replacement: string,
      options: FsReplaceOptions = {}
    ): Promise<FsReplaceResult[]> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );
      if (typeof query !== 'string' || typeof replacement !== 'string') {
        return [];
      }
      if (!query || query.length === 0) return [];

      const safeOptions = isRecord(options) ? options : {};
      const regexMode = safeOptions.regex === true;
      const re = buildSearchRegex(query, safeOptions);
      if (!re) return [];

      const maxMatchesPerFile = coercePositiveLimit(
        safeOptions.maxMatchesPerFile,
        20,
        200
      );
      const maxTotalMatches = coercePositiveLimit(
        safeOptions.maxTotalMatches,
        500,
        5_000
      );
      const maxFileSize = coercePositiveLimit(
        safeOptions.maxFileSize,
        1_000_000,
        1_000_000
      );
      const maxFilesScanned = coercePositiveLimit(
        safeOptions.maxFilesScanned,
        5_000,
        20_000
      );
      const perLineTimeoutMs = coercePositiveLimit(
        safeOptions.perLineTimeoutMs,
        50,
        250
      );

      const results: FsReplaceResult[] = [];
      let totalMatches = 0;

      const NUL = String.fromCharCode(0);
      function looksBinary(text: string): boolean {
        const probe = text.slice(0, 1024);
        return probe.includes(NUL);
      }

      await walkProject(
        absolutePath,
        relativePath,
        async (filePath, fileRelativePath) => {
          if (totalMatches >= maxTotalMatches) return false;
          let info;
          try {
            info = await statAsync(filePath);
          } catch {
            return true;
          }
          if (!info.isFile() || info.size > maxFileSize) return true;
          let content: string;
          try {
            content = await readFile(filePath, 'utf8');
          } catch {
            return true;
          }
          if (looksBinary(content)) return true;

          const fileMatches: FsReplaceMatch[] = [];
          const lines = content.split(/\r?\n/);
          let fileTimedOut = false;
          const fileDeadline = Date.now() + perLineTimeoutMs * lines.length;
          // RL-024 Slice 2 — extra cap beyond the per-file deadline.
          // `String.prototype.matchAll` runs synchronously per line; a
          // single catastrophic-backtracking pattern (e.g. `(a+)+$`
          // against a megabyte-wide minified line) blocks the Node
          // event loop until the regex returns. The per-file deadline
          // is checked BETWEEN lines, not inside `matchAll`, so lines
          // larger than this threshold are skipped to bound the
          // regex's worst case. Reviewer-flagged HIGH.
          const MAX_LINE_BYTES = 200_000;

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (fileMatches.length >= maxMatchesPerFile) break;
            if (totalMatches + fileMatches.length >= maxTotalMatches) break;
            if (Date.now() > fileDeadline) {
              fileTimedOut = true;
              break;
            }
            const rawLine = lines[lineIndex]!;
            if (rawLine.length > MAX_LINE_BYTES) {
              // Treat over-long lines as if they had no match. Surfacing
              // this through `regexTimedOut` is honest because the
              // failure mode is identical: the file's preview is
              // incomplete for the user.
              fileTimedOut = true;
              continue;
            }
            // RL-024 Slice 2 fold C — `matchAll` returns an iterator
            // so we never call the `.exec` method directly. The `g`
            // flag is required for matchAll and already set by
            // `buildSearchRegex`.
            const matches: RegExpMatchArray[] = [];
            let matchCount = 0;
            for (const m of rawLine.matchAll(re)) {
              matches.push(m);
              matchCount += 1;
              if (matchCount >= 50) break;
            }
            const singleMatchRegex = new RegExp(
              re.source,
              re.flags.replace('g', '')
            );
            for (const m of matches) {
              if (fileMatches.length >= maxMatchesPerFile) break;
              if (typeof m.index !== 'number') continue;
              const PREVIEW_BUDGET = 240;
              const previewStart = Math.max(0, m.index - 80);
              const previewEnd = Math.min(
                rawLine.length,
                previewStart + PREVIEW_BUDGET
              );
              const preview = rawLine.slice(previewStart, previewEnd);
              const matchedText = m[0]!;
              const singleReplacement = replacementForMatch(
                matchedText,
                singleMatchRegex,
                replacement,
                regexMode
              );
              // RL-024 Slice 2 — substitute ONLY this match's text in
              // place. The previous implementation called
              // `rawLine.replace(re, replacement)` (global) and sliced
              // the result with the original line's offsets, which was
              // incorrect on multi-match lines because earlier
              // substitutions shift the byte positions of later ones.
              // Reviewer-flagged HIGH.
              const replacedLine =
                rawLine.slice(0, m.index) +
                singleReplacement +
                rawLine.slice(m.index + matchedText.length);
              const replacedPreviewEnd = Math.min(
                replacedLine.length,
                previewStart + PREVIEW_BUDGET
              );
              const replacedPreview = replacedLine.slice(
                previewStart,
                replacedPreviewEnd
              );
              fileMatches.push({
                line: lineIndex + 1,
                column: m.index + 1,
                preview,
                matchStart: m.index - previewStart,
                matchEnd: m.index - previewStart + matchedText.length,
                replacedPreview,
                replacement: singleReplacement,
              });
            }
          }

          if (fileMatches.length > 0) {
            results.push({
              relativePath: fileRelativePath,
              matches: fileMatches,
              ...(fileTimedOut ? { regexTimedOut: true } : {}),
            });
            totalMatches += fileMatches.length;
          } else if (fileTimedOut) {
            results.push({
              relativePath: fileRelativePath,
              matches: [],
              regexTimedOut: true,
            });
          }
          return totalMatches < maxTotalMatches;
        },
        maxFilesScanned
      );

      return results;
    }
  );

  ipcMain.handle(
    'fs:applyReplaceInFile',
    async (
      _event,
      rootId: RootId,
      relativePath: string,
      query: string,
      replacement: string,
      options: FsReplaceOptions = {}
    ): Promise<FsApplyReplaceResult> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'write'
      );
      if (typeof query !== 'string' || typeof replacement !== 'string') {
        return { ok: false, replaced: 0, reason: 'unsupported' };
      }
      if (!query || query.length === 0) {
        return { ok: false, replaced: 0, reason: 'no-matches' };
      }
      const safeOptions = isRecord(options) ? options : {};
      const regexMode = safeOptions.regex === true;
      const re = buildSearchRegex(query, safeOptions);
      if (!re) return { ok: false, replaced: 0, reason: 'invalid-regex' };

      const maxFileSize = coercePositiveLimit(
        safeOptions.maxFileSize,
        1_000_000,
        1_000_000
      );
      const NUL = String.fromCharCode(0);

      let info;
      try {
        info = await statAsync(absolutePath);
      } catch {
        return { ok: false, replaced: 0, reason: 'read-error' };
      }
      if (!info.isFile()) {
        return { ok: false, replaced: 0, reason: 'read-error' };
      }
      if (info.size > maxFileSize) {
        return { ok: false, replaced: 0, reason: 'too-large' };
      }

      let content: string;
      try {
        content = await readFile(absolutePath, 'utf8');
      } catch {
        return { ok: false, replaced: 0, reason: 'read-error' };
      }
      if (content.slice(0, 1024).includes(NUL)) {
        return { ok: false, replaced: 0, reason: 'binary' };
      }

      // Count matches via matchAll iterator (avoids the .exec API).
      let replaced = 0;
      for (const _ of content.matchAll(re)) {
        replaced += 1;
        if (replaced > 100_000) break; // hard cap defense
        void _;
      }
      if (replaced === 0) {
        return { ok: false, replaced: 0, reason: 'no-matches' };
      }

      const next = replaceAllMatches(
        content,
        new RegExp(re.source, re.flags),
        replacement,
        regexMode
      );

      // Atomic write: tmpfile in same directory + rename. Same-FS
      // rename is POSIX-atomic; Windows AV can lock the target, so
      // retry up to 3 times with exponential backoff.
      const dir = path.dirname(absolutePath);
      const base = path.basename(absolutePath);
      const tmpPath = path.join(
        dir,
        `.${base}.tmp-${randomUUID().slice(0, 8)}`
      );
      try {
        await writeFile(tmpPath, next, 'utf8');
      } catch {
        try {
          await unlink(tmpPath);
        } catch {
          /* best-effort */
        }
        return { ok: false, replaced: 0, reason: 'write-error' };
      }

      const renameWithRetry = async (): Promise<boolean> => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await renameFs(tmpPath, absolutePath);
            return true;
          } catch {
            await new Promise((r) =>
              setTimeout(r, [10, 100, 1000][attempt] ?? 1000)
            );
          }
        }
        return false;
      };
      const renamed = await renameWithRetry();
      if (!renamed) {
        try {
          await unlink(tmpPath);
        } catch {
          /* best-effort */
        }
        return { ok: false, replaced: 0, reason: 'write-error' };
      }
      return { ok: true, replaced };
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
  ipcMain.handle(
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

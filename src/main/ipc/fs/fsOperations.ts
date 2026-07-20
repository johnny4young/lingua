/** Core picker, capability, dialog, and file-operation IPC handlers. */

import { BrowserWindow, dialog, shell } from 'electron';
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
import path from 'node:path';
import { OPEN_FILE_FILTERS } from '../../../shared/filePickerTypes';
import { asRelativePath } from '../../../shared/fs/brandedIds';
import { translateCommon } from '../../../shared/i18n/runtime';
import { blockedPathFamily, isPathBlocked, isSafeEntryName } from '../permissions';
import {
  mintFileCapability,
  mintRootCapability,
  resolveCapabilityPath,
  revokeRoot,
  type RootId,
} from '../projectCapabilities';
import { typedHandle } from '../typedHandle';
import {
  hasApprovedFile,
  hasApprovedRoot,
  rememberApprovedFile,
  rememberApprovedRoot,
} from './fsApprovals';
import { registerBundleHandlers } from './fsBundle';
import { registerSearchReplaceHandlers } from './fsSearchReplace';
import {
  CapabilityError,
  dirnameRelative,
  joinRelative,
  resolveOrThrow,
  shouldHide,
} from './fsShared';

export function registerFileOperationHandlers(): void {
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

  // implementation detail — read-only classification so the renderer can show an
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

  // implementation note — open the OS file manager (Finder /
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
      // implementation note — `shell.showItemInFolder` is a void
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
}

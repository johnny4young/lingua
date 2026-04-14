/**
 * File system IPC handlers for the main process.
 *
 * Provides secure file operations with:
 * - Path blocking for system/sensitive directories
 * - Confirmation dialogs for destructive operations (delete)
 * - Native file/directory picker dialogs
 * - Watch mode for detecting external file changes
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import {
  readFile,
  writeFile,
  unlink,
  rename,
  mkdir,
  readdir,
  stat,
  rm,
} from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { translateCommon } from '../../shared/i18n/runtime';
import { isPathBlocked, isSafeEntryName } from './permissions';

/** Active file system watchers keyed by directory path */
const watchers = new Map<string, () => void>();

/**
 * Directories and files to filter out of the file tree.
 * Keeps the tree clean and avoids exposing build artifacts or VCS internals.
 */
const HIDDEN_ENTRIES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'target',       // Rust build output
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

export function registerFileSystemHandlers(): void {
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

  // ---------------------------------------------------------------- dialogs

  ipcMain.handle('fs:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:select-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(
    'fs:save-dialog',
    async (_event, defaultName: string, defaultDir?: string) => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultDir
          ? path.join(defaultDir, defaultName)
          : defaultName,
      });
      if (result.canceled || !result.filePath) return null;
      if (isPathBlocked(result.filePath, 'write')) {
        throw new Error(
          `Access denied: Cannot save to protected path: ${result.filePath}`
        );
      }
      return result.filePath;
    }
  );

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

  ipcMain.handle('fs:readdir', async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !shouldHide(e.name))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name),
      }));
  });

  // ------------------------------------------------------------------ stat

  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    const s = await stat(filePath);
    return {
      size: s.size,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      mtime: s.mtime.toISOString(),
      ctime: s.ctime.toISOString(),
    };
  });

  // ------------------------------------------------------------------ read

  ipcMain.handle('fs:read', async (_event, filePath: string) => {
    if (isPathBlocked(filePath, 'read')) {
      throw new Error(
        `Access denied: Cannot read protected path: ${filePath}`
      );
    }
    return readFile(filePath, 'utf-8');
  });

  // ----------------------------------------------------------------- write

  ipcMain.handle(
    'fs:write',
    async (_event, filePath: string, content: string) => {
      if (isPathBlocked(filePath, 'write')) {
        throw new Error(
          `Access denied: Cannot write to protected path: ${filePath}`
        );
      }
      await writeFile(filePath, content, 'utf-8');
      return true;
    }
  );

  // ---------------------------------------------------------------- delete

  ipcMain.handle(
    'fs:delete',
    async (event, filePath: string, isDirectory = false, language?: string) => {
      if (isPathBlocked(filePath, 'delete')) {
        throw new Error(
          `Access denied: Cannot delete protected path: ${filePath}`
        );
      }

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
          name: path.basename(filePath),
        }),
        detail: isDirectory
          ? t(language, 'dialogs.delete.detail.directory')
          : t(language, 'dialogs.delete.detail.file'),
      });

      if (response !== 0) return false; // user cancelled

      if (isDirectory) {
        await rm(filePath, { recursive: true, force: true });
      } else {
        await unlink(filePath);
      }
      return true;
    }
  );

  // ---------------------------------------------------------------- rename

  ipcMain.handle(
    'fs:rename',
    async (_event, oldPath: string, newName: string) => {
      assertSafeEntryName(newName, 'name for rename');
      const newPath = path.join(path.dirname(oldPath), newName);
      if (isPathBlocked(oldPath, 'write')) {
        throw new Error(
          `Access denied: Cannot rename protected path: ${oldPath}`
        );
      }
      if (isPathBlocked(newPath, 'write')) {
        throw new Error(
          `Access denied: Cannot write to protected path: ${newPath}`
        );
      }
      await rename(oldPath, newPath);
      return newPath;
    }
  );

  // ----------------------------------------------------------------- mkdir

  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    if (isPathBlocked(dirPath, 'write')) {
      throw new Error(
        `Access denied: Cannot create directory at protected path: ${dirPath}`
      );
    }
    await mkdir(dirPath, { recursive: true });
    return true;
  });

  // ----------------------------------------------------------------- touch (create empty file)

  ipcMain.handle('fs:touch', async (_event, filePath: string) => {
    if (isPathBlocked(filePath, 'write')) {
      throw new Error(
        `Access denied: Cannot create file at protected path: ${filePath}`
      );
    }
    await writeFile(filePath, '', 'utf-8');
    return true;
  });

  // --------------------------------------------------------------- watch

  ipcMain.handle('fs:watch-start', (event, dirPath: string) => {
    if (isPathBlocked(dirPath, 'read')) {
      throw new Error(
        `Access denied: Cannot watch protected path: ${dirPath}`
      );
    }
    // Stop any existing watcher on this path
    const existingStop = watchers.get(dirPath);
    if (existingStop) existingStop();

    const watcher = watch(
      dirPath,
      { recursive: true },
      (eventType, filename) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('fs:changed', { dirPath, eventType, filename });
        }
      }
    );

    watchers.set(dirPath, () => watcher.close());
    return dirPath;
  });

  ipcMain.handle('fs:watch-stop', (_event, watchId: string) => {
    const stop = watchers.get(watchId);
    if (stop) {
      stop();
      watchers.delete(watchId);
    }
    return true;
  });
}

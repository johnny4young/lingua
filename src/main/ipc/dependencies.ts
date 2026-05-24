/**
 * RL-025 Slice A + Slice B - IPC handlers for JS / TS dependency
 * resolution and installation.
 *
 * Slice A channels:
 *   - `dependencies:js:resolve` — read-only batch resolver. Returns
 *     one status per name from the active tab's resolved cwd.
 *
 * Slice B channels:
 *   - `dependencies:js:install` — `npm install` batch via
 *     `child_process.spawn` with `shell: false`. Streams log lines
 *     back to the renderer via `webContents.send('dependencies:js:install:log', …)`
 *     keyed by `runId`. Returns one final status per requested
 *     specifier plus the whole-batch outcome enum.
 *   - `dependencies:js:install:cancel` — SIGTERM → SIGKILL by
 *     `runId`.
 */

import { ipcMain } from 'electron';
import {
  cancelJsDependencyInstall,
  installJsDependencyBatch,
  resolveJsDependencyBatch,
  type DependencyInstallLogStream,
  type DependencyInstallResult,
  type DependencyResolveResult,
} from '../dependencies';

export const INSTALL_LOG_CHANNEL = 'dependencies:js:install:log';

export function registerDependencyHandlers(): void {
  ipcMain.handle(
    'dependencies:js:resolve',
    async (
      _event,
      rawSpecifiers: unknown,
      rawFilePath: unknown
    ): Promise<DependencyResolveResult> => {
      const specifiers = Array.isArray(rawSpecifiers) ? rawSpecifiers : [];
      const filePath =
        typeof rawFilePath === 'string' ? rawFilePath : undefined;
      return resolveJsDependencyBatch(specifiers, filePath);
    }
  );

  ipcMain.handle(
    'dependencies:js:install',
    async (
      event,
      rawRunId: unknown,
      rawSpecifiers: unknown,
      rawFilePath: unknown
    ): Promise<DependencyInstallResult> => {
      const runId = typeof rawRunId === 'string' ? rawRunId : '';
      const specifiers = Array.isArray(rawSpecifiers)
        ? rawSpecifiers.filter(
            (entry): entry is string => typeof entry === 'string'
          )
        : [];
      const filePath = typeof rawFilePath === 'string' ? rawFilePath : '';
      if (!runId || specifiers.length === 0 || !filePath) {
        return {
          statuses: {},
          outcome: 'failed',
          failureReason: 'invalid-specifier',
          cwd: null,
          exitCode: -1,
        };
      }
      // Use a weak reference into the renderer's webContents so we
      // can stream log chunks back without keeping the BrowserWindow
      // alive past close.
      const sender = event.sender;
      return installJsDependencyBatch({
        runId,
        filePath,
        specifiers,
        onLog: (stream: DependencyInstallLogStream, chunk: string) => {
          if (sender.isDestroyed()) return;
          sender.send(INSTALL_LOG_CHANNEL, { runId, stream, chunk });
        },
      });
    }
  );

  ipcMain.handle(
    'dependencies:js:install:cancel',
    async (_event, rawRunId: unknown): Promise<{ cancelled: boolean }> => {
      if (typeof rawRunId !== 'string' || rawRunId.length === 0) {
        return { cancelled: false };
      }
      return { cancelled: cancelJsDependencyInstall(rawRunId) };
    }
  );
}

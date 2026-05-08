/**
 * RL-090 — recovery IPC handlers.
 *
 *   - `recovery:confirm-reset` — destructive-action confirm dialog
 *     for the five RecoverySection actions. Different copy per
 *     scope so a "reset settings" prompt doesn't read as "reset
 *     everything".
 *   - `recovery:reveal-folder` — open the OS file browser at the
 *     app's userData folder so a user with a corrupted persisted
 *     state can wipe files manually when the renderer cannot
 *     mount.
 *
 * Web has no native dialog or file browser; the web stub for both
 * resolves to a safe no-op (cancel / unsupported) and the
 * RecoverySection falls through to its inline confirm step / hides
 * the reveal-folder button.
 */

import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron';
import { translateCommon } from '../../shared/i18n/runtime';

export type ResetScope =
  | 'settings'
  | 'snippets'
  | 'envVars'
  | 'session'
  | 'factory';

const VALID_SCOPES: ReadonlySet<string> = new Set([
  'settings',
  'snippets',
  'envVars',
  'session',
  'factory',
]);

const t = (
  language: string | undefined,
  key: string,
  options?: Record<string, unknown>
) => translateCommon(language ?? 'en', key, options);

export function registerRecoveryHandlers(): void {
  ipcMain.handle(
    'recovery:confirm-reset',
    async (event, rawScope: unknown, language?: string) => {
      const scope =
        typeof rawScope === 'string' && VALID_SCOPES.has(rawScope)
          ? (rawScope as ResetScope)
          : 'settings';

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return 1;

      const scopeLabel = t(language, `recovery.scope.${scope}`);
      const hint = t(language, `recovery.action.${scope}.hint`);

      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [
          t(language, 'recovery.confirm.reset'),
          t(language, 'recovery.confirm.cancel'),
        ],
        defaultId: 1,
        cancelId: 1,
        title: t(language, 'recovery.confirm.title', { scope: scopeLabel }),
        message: t(language, 'recovery.confirm.message'),
        detail: t(language, 'recovery.confirm.detail', { hint }),
      });
      return response;
    }
  );

  ipcMain.handle('recovery:reveal-folder', async () => {
    if (typeof app?.getPath !== 'function' || typeof shell?.openPath !== 'function') {
      return { ok: false, reason: 'unsupported' } as const;
    }
    try {
      const userData = app.getPath('userData');
      const errorMessage = await shell.openPath(userData);
      if (errorMessage) {
        return { ok: false, reason: 'open-failed', message: errorMessage } as const;
      }
      return { ok: true } as const;
    } catch (error) {
      return {
        ok: false,
        reason: 'open-failed',
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  });
}

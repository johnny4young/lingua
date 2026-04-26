/**
 * License IPC handlers (RL-059 Slice 0).
 *
 * Bridges `window.lingua.license.*` calls in the renderer to the main-side
 * runtime created in `src/main/license.ts`. The renderer never imports
 * `node:crypto` or touches the user-data directory directly — every state
 * mutation lands on this module first.
 */

import { ipcMain } from 'electron';
import type { LicenseRuntime, LicenseSnapshot, LicenseStatus } from '../license';

export type LicenseApplyResult =
  | { ok: true; status: LicenseStatus; snapshot: LicenseSnapshot }
  | { ok: false; reason: string; message?: string };

export function registerLicenseHandlers(runtime: LicenseRuntime): void {
  ipcMain.handle('license:get-state', async () => runtime.getSnapshot());

  ipcMain.handle('license:apply-token', async (_event, token: unknown): Promise<LicenseApplyResult> => {
    if (typeof token !== 'string') {
      return { ok: false, reason: 'invalid-input', message: 'Expected a string token.' };
    }
    try {
      const status = await runtime.applyToken(token);
      return { ok: true, status, snapshot: runtime.getSnapshot() };
    } catch (error) {
      return {
        ok: false,
        reason: 'apply-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('license:clear', async (): Promise<{ ok: true; snapshot: LicenseSnapshot } | { ok: false; reason: string; message?: string }> => {
    try {
      await runtime.clear();
      return { ok: true, snapshot: runtime.getSnapshot() };
    } catch (error) {
      return {
        ok: false,
        reason: 'clear-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('license:revalidate', async (): Promise<LicenseApplyResult> => {
    try {
      const status = await runtime.revalidate();
      return { ok: true, status, snapshot: runtime.getSnapshot() };
    } catch (error) {
      return {
        ok: false,
        reason: 'revalidate-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

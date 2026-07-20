/**
 * internal — confirm dialog for the destructive `replace` policy of the
 * profile-restore flow. Mirrors `app:confirm-close` in
 * `src/main/ipc/fileSystem.ts`. The renderer ProfileSection invokes
 * this only for `replace`; `merge` and `preserve` apply directly.
 *
 * Web has no native confirm modal — the web build's `ProfileSection`
 * falls back to an inline confirm step inside the section UI.
 */

import { dialog, BrowserWindow } from 'electron';
import type { Result } from '../../shared/result';
import { typedHandle } from './typedHandle';
import { translateCommon } from '../../shared/i18n/runtime';

export interface ConfirmReplaceCounts {
  snippets: number;
  envVars: number;
}

const t = (
  language: string | undefined,
  key: string,
  options?: Record<string, unknown>
) => translateCommon(language ?? 'en', key, options);

function sanitizeCount(raw: unknown): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function registerProfileHandlers(): void {
  typedHandle(
    'profile:confirm-replace',
    async (
      event,
      rawCounts: unknown,
      language?: string
    ): Promise<Result<number, 'confirm-failed'>> => {
      // internal — `counts` arrives over IPC; coerce to safe finite
      // integers so a renderer cannot make the dialog interpolate
      // `Infinity`, `NaN`, or string-shaped values that read as
      // garbage in the native message box.
      const counts = (rawCounts ?? {}) as Partial<ConfirmReplaceCounts>;
      const safeCounts = {
        snippets: sanitizeCount(counts.snippets),
        envVars: sanitizeCount(counts.envVars),
      };

      // BrowserWindow.fromWebContents returns null for webviews /
      // utility processes. Treat that as cancel rather than `win!`
      // and risk a throw — an unhandled rejection would leave the
      // renderer waiting on a destructive flow.
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: true, data: 1 };

      try {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: [
            t(language, 'profile.replaceConfirm.replace'),
            t(language, 'profile.replaceConfirm.cancel'),
          ],
          defaultId: 1,
          cancelId: 1,
          title: t(language, 'profile.replaceConfirm.title'),
          message: t(language, 'profile.replaceConfirm.message'),
          detail: t(language, 'profile.replaceConfirm.detail', safeCounts),
        });
        return { ok: true, data: response };
      } catch (error) {
        return {
          ok: false,
          reason: 'confirm-failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

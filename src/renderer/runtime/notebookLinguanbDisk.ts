/**
 * RL-043 Slice E fold A — desktop native "Save to disk" for a
 * `.linguanb` document, via the existing RL-077 capability sandbox.
 *
 * No NEW IPC or security surface: `fs.saveDialog` mints a one-file
 * write capability for the user-chosen path, `fs.write` is validated
 * against that exact capability, and the capability is revoked
 * afterward. Identical to the editor's own Save-As flow
 * (`editorPersistence.persistTab`), just for a one-off notebook
 * document rather than a tracked file tab.
 *
 * Web uses the blob download (`downloadTextFile`) even though the web
 * adapter also exposes an FSA-backed `window.lingua.fs` shim for editor
 * files; `'unavailable'` signals that fallback so unsupported/cancelled
 * browser save-pickers never swallow the export.
 * The matching OPEN flow is served by the global Import overlay's file
 * picker, which already accepts `.linguanb` (fold D) and routes it
 * through the registered `linguanbImporter` on web AND desktop.
 */

import { downloadTextFile } from '../utils/downloadTextFile';

/** MIME hint for a `.linguanb` download — shared by both export paths. */
export const LINGUANB_MIME = 'application/x-linguanb+json;charset=utf-8';

/** Outcome of a native `.linguanb` save attempt. */
export type LinguanbSaveOutcome = 'saved' | 'canceled' | 'unavailable' | 'error';

export async function saveLinguanbViaCapability(
  json: string,
  suggestedName: string
): Promise<LinguanbSaveOutcome> {
  if (window.lingua?.platform === 'web') return 'unavailable';
  const fs = window.lingua?.fs;
  if (!fs?.saveDialog || !fs.write) return 'unavailable';
  let mintedRootId: Parameters<typeof fs.write>[0] | null = null;
  try {
    const result = await fs.saveDialog(suggestedName);
    if (result.canceled) return result.blockedFamily ? 'error' : 'canceled';
    mintedRootId = result.rootId;
    const wrote = await fs.write(result.rootId, result.fileRelativePath, json);
    return wrote ? 'saved' : 'error';
  } catch {
    return 'error';
  } finally {
    // Revoke the one-file capability the dialog minted — we only needed
    // it for this single write.
    if (mintedRootId && fs.revokeRoot) {
      await fs.revokeRoot(mintedRootId).catch(() => {});
    }
  }
}

/**
 * Save a serialized `.linguanb` document, preferring the desktop native
 * Save dialog (capability sandbox) and falling back to the web blob
 * download. Shared by the notebook toolbar export and the command-palette
 * "Export notebook as .linguanb" action so the save → fallback → notify
 * orchestration (and the MIME hint) lives in one place rather than being
 * copied at each call site.
 *
 * Outcome routing:
 *   - `'saved'` / a successful blob download → `onOk`.
 *   - `'canceled'` (user dismissed the dialog) → no notice; a deliberate
 *     no-op so a cancel never reads as success or failure.
 *   - `'error'`, or a thrown blob download → `onError`.
 */
export async function saveOrDownloadLinguanb(
  json: string,
  suggestedName: string,
  handlers: { onOk: () => void; onError: () => void }
): Promise<void> {
  const outcome = await saveLinguanbViaCapability(json, suggestedName);
  if (outcome === 'saved') return handlers.onOk();
  if (outcome === 'canceled') return;
  if (outcome === 'error') return handlers.onError();
  // 'unavailable' — web build: blob download fallback.
  try {
    downloadTextFile(json, suggestedName, LINGUANB_MIME);
    handlers.onOk();
  } catch {
    handlers.onError();
  }
}

/**
 * IT2-F7 — generic "save a text document to disk" orchestration,
 * extracted from the `.linguanb` exporter (RL-043 Slice E fold A) so
 * the capsule HTML export shares the exact same native-dialog →
 * capability-write → blob-download fallback instead of copying it.
 *
 * No NEW IPC or security surface: `fs.saveDialog` mints a one-file
 * write capability for the user-chosen path, `fs.write` is validated
 * against that exact capability, and the capability is revoked
 * afterward (RL-077 sandbox). Web reports `'unavailable'` so callers
 * fall back to the blob download — unsupported/cancelled browser
 * save-pickers never swallow an export.
 */

import { downloadTextFile } from './downloadTextFile';

/** Outcome of a native capability-backed save attempt. */
export type TextFileSaveOutcome = 'saved' | 'canceled' | 'unavailable' | 'error';

export async function saveTextViaCapability(
  content: string,
  suggestedName: string
): Promise<TextFileSaveOutcome> {
  if (window.lingua?.platform === 'web') return 'unavailable';
  const fs = window.lingua?.fs;
  if (!fs?.saveDialog || !fs.write) return 'unavailable';
  let mintedRootId: Parameters<typeof fs.write>[0] | null = null;
  try {
    const result = await fs.saveDialog(suggestedName);
    if (result.canceled) return result.blockedFamily ? 'error' : 'canceled';
    mintedRootId = result.rootId;
    const wrote = await fs.write(result.rootId, result.fileRelativePath, content);
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
 * Save a text document, preferring the desktop native Save dialog
 * (capability sandbox) and falling back to the web blob download.
 *
 * Outcome routing:
 *   - `'saved'` / a successful blob download → `onOk`.
 *   - `'canceled'` (user dismissed the dialog) → no handler; a deliberate
 *     no-op so a cancel never reads as success or failure.
 *   - `'error'`, or a thrown blob download → `onError`.
 */
export async function saveOrDownloadTextFile(
  content: string,
  suggestedName: string,
  mimeType: string,
  handlers: { onOk: () => void; onError: () => void }
): Promise<void> {
  const outcome = await saveTextViaCapability(content, suggestedName);
  if (outcome === 'saved') return handlers.onOk();
  if (outcome === 'canceled') return;
  if (outcome === 'error') return handlers.onError();
  // 'unavailable' — web build: blob download fallback.
  try {
    downloadTextFile(content, suggestedName, mimeType);
    handlers.onOk();
  } catch {
    handlers.onError();
  }
}

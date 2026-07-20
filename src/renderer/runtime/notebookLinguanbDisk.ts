/**
 * implementation Slice E implementation note — desktop native "Save to disk" for a
 * `.linguanb` document, via the existing internal capability sandbox.
 *
 * internal moved the generic dialog → capability-write → blob-download
 * orchestration to `utils/saveTextFileToDisk.ts` so the capsule HTML
 * export shares it; this module keeps the `.linguanb`-specific MIME
 * hint and the names its callers (notebook toolbar + command palette)
 * already import.
 *
 * Web uses the blob download (`downloadTextFile`) even though the web
 * adapter also exposes an FSA-backed `window.lingua.fs` shim for editor
 * files; `'unavailable'` signals that fallback so unsupported/cancelled
 * browser save-pickers never swallow the export.
 * The matching OPEN flow is served by the global Import overlay's file
 * picker, which already accepts `.linguanb` (implementation note) and routes it
 * through the registered `linguanbImporter` on web AND desktop.
 */

import {
  saveOrDownloadTextFile,
  saveTextViaCapability,
  type TextFileSaveOutcome,
} from '../utils/saveTextFileToDisk';

/** MIME hint for a `.linguanb` download — shared by both export paths. */
export const LINGUANB_MIME = 'application/x-linguanb+json;charset=utf-8';

/** Outcome of a native `.linguanb` save attempt. */
export type LinguanbSaveOutcome = TextFileSaveOutcome;

export async function saveLinguanbViaCapability(
  json: string,
  suggestedName: string
): Promise<LinguanbSaveOutcome> {
  return saveTextViaCapability(json, suggestedName);
}

/**
 * Save a serialized `.linguanb` document, preferring the desktop native
 * Save dialog (capability sandbox) and falling back to the web blob
 * download. Shared by the notebook toolbar export and the command-palette
 * "Export notebook as .linguanb" action.
 *
 * Outcome routing (see `saveOrDownloadTextFile`): saved/downloaded →
 * `onOk`; user-cancelled dialog → deliberate no-op; error → `onError`.
 */
export async function saveOrDownloadLinguanb(
  json: string,
  suggestedName: string,
  handlers: { onOk: () => void; onError: () => void }
): Promise<void> {
  return saveOrDownloadTextFile(json, suggestedName, LINGUANB_MIME, handlers);
}

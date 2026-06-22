/**
 * RL-043 Slice E — export a Lingua notebook to its native `.linguanb`
 * document, the lossless counterpart of `notebookExportToIpynb.ts`.
 *
 * Pure helper (mirrors `notebookExportToScript` / `notebookExportToIpynb`):
 * the component layer wraps the JSON in a `Blob` + `URL.createObjectURL`
 * for download (web) or hands it to the capability IPC for a disk save
 * (desktop, fold A). No clipboard / no IPC here.
 *
 * Unlike the `.ipynb` export, `.linguanb` is lossless — it embeds the
 * full `NotebookV1` plus the transient per-cell `[N]` execution-order
 * map (fold B), so re-importing it via the `linguanbImporter` restores
 * the notebook with nothing dropped.
 */

import {
  serializeNotebookDocument,
  LINGUANB_FILE_EXTENSION,
} from '../../../shared/notebookDocument';
import type { NotebookV1 } from '../../../shared/notebook';

/** Result of a `.linguanb` export — pretty-printed JSON + a suggested name. */
export interface NotebookLinguanbExportResult {
  /** Pretty-printed `.linguanb` JSON, ready for a `Blob`. */
  readonly json: string;
  /** Suggested file name (kebab-cased title + `.linguanb`). */
  readonly suggestedFileName: string;
}

/**
 * Serialize a notebook to a `.linguanb` document.
 *
 * @param notebook the notebook to export.
 * @param opts.executionOrder per-cell Jupyter `[N]` stamps (fold B); the
 *   serializer sanitizes them to the document's cells + positive ints.
 *   The map is transient store state, so the caller threads it in.
 */
export function exportNotebookAsLinguanb(
  notebook: NotebookV1,
  opts: { executionOrder?: Readonly<Record<string, number>> } = {}
): NotebookLinguanbExportResult {
  const json = serializeNotebookDocument(notebook, {
    ...(opts.executionOrder ? { executionOrder: opts.executionOrder } : {}),
  });
  return {
    json,
    suggestedFileName: `${toKebabCase(notebook.title || 'notebook')}${LINGUANB_FILE_EXTENSION}`,
  };
}

function toKebabCase(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'notebook'
  );
}

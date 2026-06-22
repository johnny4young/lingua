/**
 * RL-043 Slice E — `.linguanb` → `NotebookV1` importer adapter.
 *
 * The lossless counterpart to the `.ipynb` importer (`ipynbImporter.ts`).
 * A `.linguanb` document is Lingua's own native notebook format
 * (`src/shared/notebookDocument.ts`), so this adapter is thin: the
 * heavy validation lives in `parseNotebookDocument`, and the preview
 * reuses the exact `.ipynb` preview-band helpers so the Import overlay
 * renders both notebook formats through one `<NotebookPreviewBand>`.
 *
 * Lossless by design — there are NO lossy warnings (`warnings` is
 * always empty): a `.linguanb` round-trips cell ids, per-cell language
 * (incl. TypeScript), markdown, outputs, title, createdAt, and the
 * per-cell `[N]` execution-order stamps. Pure parser; NO IPC, NO
 * network, NO sandboxed eval.
 */

import {
  detectLinguanbDocument,
  parseNotebookDocument,
  type LinguanbRejectReason,
} from '../notebookDocument';
import {
  buildCellSnippets,
  countCells,
  pickDominantLanguage,
  type IpynbCellSnippet,
} from './ipynbImporter';
import type { NotebookCellLanguage, NotebookV1 } from '../notebook';
import type {
  ImporterAdapter,
  ImporterLossyWarning,
  ImporterPreviewOutcome,
} from './types';

/**
 * Preview shape returned by `adapter.preview(source)`. Carries the same
 * fields `<NotebookPreviewBand>` reads from the `.ipynb` preview so the
 * UI reuses one renderer; `kind: 'linguanb-notebook'` flips the band's
 * badge to "native / lossless" (fold C). `executionOrder` (fold B) is
 * restored into the store on confirm.
 */
export interface LinguanbImporterPreview {
  readonly kind: 'linguanb-notebook';
  /** The lossless `NotebookV1` ready for `installImportedNotebook`. */
  readonly notebook: NotebookV1;
  /** Per-cell `[N]` execution stamps to restore on confirm (fold B). */
  readonly executionOrder?: Readonly<Record<string, number>>;
  /** Snippets of the first up-to-3 cells for the preview band. */
  readonly cellSnippets: ReadonlyArray<IpynbCellSnippet>;
  /** Cell counts (summary chip). `droppedRaw` is always 0 — lossless. */
  readonly cellCounts: {
    readonly total: number;
    readonly code: number;
    readonly markdown: number;
    readonly droppedRaw: number;
  };
  /** Dominant code-cell language; `null` on a tie / no code cells. */
  readonly dominantLanguage: NotebookCellLanguage | null;
  /** Notebook title (preserved verbatim from the document). */
  readonly title: string;
  /** Always empty — `.linguanb` import is lossless. */
  readonly warnings: ReadonlyArray<ImporterLossyWarning>;
}

/** Commit shape — what `import(preview)` hands back to the caller. */
export interface LinguanbImporterResult {
  readonly notebook: NotebookV1;
  readonly title: string;
  readonly dominantLanguage: NotebookCellLanguage | null;
  readonly executionOrder?: Readonly<Record<string, number>>;
}

/**
 * Map a `LinguanbRejectReason` to the generic `IMPORTER_REJECT_REASONS`
 * surface, carrying the specific code in `detail` so the UI can render
 * an `importPreview.reject.linguanb.<code>` hint. `malformed-json` /
 * `invalid-shape` → `'malformed'`; `wrong-version` / `oversized` →
 * `'unsupported-feature'`.
 */
function rejectWith(
  reason: LinguanbRejectReason
): ImporterPreviewOutcome<LinguanbImporterPreview> {
  const outer =
    reason === 'malformed-json' || reason === 'invalid-shape'
      ? 'malformed'
      : 'unsupported-feature';
  return { ok: false, reason: outer, detail: reason };
}

function previewLinguanb(
  source: string
): ImporterPreviewOutcome<LinguanbImporterPreview> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, reason: 'empty-input' };
  }
  const outcome = parseNotebookDocument(source);
  if (!outcome.ok) {
    return rejectWith(outcome.reason);
  }
  const { notebook, executionOrder } = outcome.document;
  const preview: LinguanbImporterPreview = {
    kind: 'linguanb-notebook',
    notebook,
    ...(executionOrder ? { executionOrder } : {}),
    cellSnippets: buildCellSnippets(notebook.cells),
    cellCounts: countCells(notebook.cells, 0),
    dominantLanguage: pickDominantLanguage(notebook.cells),
    title: notebook.title,
    warnings: [],
  };
  return { ok: true, preview, warnings: preview.warnings };
}

export const linguanbImporterAdapter: ImporterAdapter<
  LinguanbImporterPreview,
  LinguanbImporterResult
> = {
  id: 'linguanb-notebook',
  titleKey: 'importPreview.importer.linguanbNotebook.title',
  descriptionKey: 'importPreview.importer.linguanbNotebook.description',
  detect: detectLinguanbDocument,
  preview: previewLinguanb,
  import: (preview) => ({
    notebook: preview.notebook,
    title: preview.title,
    dominantLanguage: preview.dominantLanguage,
    ...(preview.executionOrder ? { executionOrder: preview.executionOrder } : {}),
  }),
};

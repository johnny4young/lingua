/**
 * RL-043 Slice B fold B — Notebook cell-run telemetry.
 *
 * Single closed-enum event `notebook.cell_executed { language, status }`.
 *   - `language` ∈ NOTEBOOK_CELL_LANGUAGES_SET (Slice A: `'javascript'`).
 *   - `status` ∈ NOTEBOOK_CELL_STATUSES_SET (`'ok' | 'error' | 'stopped'`).
 *
 * NO cell source, NO output bytes reach the wire. Mirrored on
 * `update-server/src/telemetry.ts` with a 3-way parity test
 * cross-importing the canonical `NOTEBOOK_CELL_STATUSES` tuple
 * from `src/renderer/runtime/notebookSession.ts`.
 */

import type { NotebookCellLanguage } from '../../shared/notebook';
import type { NotebookCellStatus } from '../runtime/notebookSession';
import { trackEvent } from '../utils/telemetry';

export interface NotebookCellExecutedPayload {
  language: NotebookCellLanguage;
  status: NotebookCellStatus;
}

export function trackNotebookCellExecuted(
  payload: NotebookCellExecutedPayload
): void {
  void trackEvent('notebook.cell_executed', {
    language: payload.language,
    status: payload.status,
  });
}

/**
 * RL-043 Slice C fold E — fire when the user switches a cell's language
 * via the per-cell selector. `to` ∈ NOTEBOOK_CELL_LANGUAGES_SET; an
 * adoption signal for TypeScript cells. NO cell source on the wire.
 */
export function trackNotebookCellLanguageChanged(
  to: NotebookCellLanguage
): void {
  void trackEvent('notebook.cell_language_changed', { to });
}

/**
 * RL-043 Slice D fold D — closed enum of notebook export formats. `script`
 * is the language-aware `.js`/`.ts`/`.py`/`.txt` export; `ipynb` is the
 * Jupyter nbformat v4 export; `linguanb` (RL-043 Slice E) is the native
 * lossless `.linguanb` document export.
 */
export type NotebookExportFormat = 'script' | 'ipynb' | 'linguanb';

/**
 * RL-043 Slice D fold D — fire when the user exports a notebook. `format`
 * ∈ NOTEBOOK_EXPORT_FORMATS_SET; an adoption signal for the Jupyter export.
 * NO cell source / title on the wire.
 */
export function trackNotebookExported(format: NotebookExportFormat): void {
  void trackEvent('notebook.exported', { format });
}

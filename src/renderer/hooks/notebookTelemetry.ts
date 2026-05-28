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

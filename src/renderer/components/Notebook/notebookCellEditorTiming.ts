/**
 * PERF-003 — debounce window for the notebook code-cell source
 * auto-save. Mirrors the SQL workspace
 * (`sqlQueryEditorTiming.getSqlQueryAutoSaveDebounceMs`) and the HTTP
 * request editor (`AUTO_SAVE_DEBOUNCE_MS`): the cell keeps its source in
 * local React state and only writes through the persisted notebookStore
 * after this much quiet, so a keystroke no longer persists on every
 * character or re-renders sibling cells.
 */
const CELL_SOURCE_AUTO_SAVE_DEBOUNCE_MS = 500;

export function getNotebookCellAutoSaveDebounceMs(): number {
  return CELL_SOURCE_AUTO_SAVE_DEBOUNCE_MS;
}

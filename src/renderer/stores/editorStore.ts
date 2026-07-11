import { create } from 'zustand';
import type { EditorState } from '../types';
import { createTabActions } from './editorTabActions';
import { createWorkspaceActions } from './editorWorkspaceActions';
import { createContentActions } from './editorContentActions';
import { createModeActions } from './editorModeActions';
import { createInputActions } from './editorInputActions';
import { createSaveActions } from './editorSaveActions';
import { createCloseActions } from './editorCloseActions';

/**
 * RL-128 (AUDIT-08) — editor store assembly point.
 *
 * The 1600-line monolith was carved into focused modules with ZERO public API
 * change; this file is the thin assembly that wires them together:
 *
 *   - `editorModeHelpers`    — runtime/workflow mode resolution (new + restored)
 *   - `editorTabUtils`       — pure tab helpers, capability droppers, workspace
 *                              constants, `createDefaultTab`
 *   - `editorPersistence`    — format-on-save + `persistTab` (Save/Save-As)
 *   - `editorSelectors`      — `getActiveTab` / `getActiveTabIndex`
 *   - `editorStoreContext`   — shared `EditorSet` / `EditorGet` types (fold A)
 *   - `editorTabActions`     — create / restore / remove / focus / duplicate
 *   - `editorWorkspaceActions`— notebook + SQL / HTTP / Utilities workspace openers
 *   - `editorContentActions` — buffer / execution-state / timeout / recipe-clear
 *   - `editorModeActions`    — runtime/workflow mode + capability toggles
 *   - `editorInputActions`   — stdin, argv, and named input sets
 *   - `editorSaveActions`    — open / save / save-as
 *   - `editorCloseActions`   — close (+ bulk) / rename
 *
 * Each action factory takes the zustand `(set, get)` and returns a disjoint
 * slice of `EditorState`; spreading them here reproduces the original single
 * object literal exactly. Cross-action calls (`get().saveTabById`,
 * `get().removeTab`, …) resolve against this assembled store, so factory
 * boundaries are invisible at runtime. The public re-exports below preserve
 * every symbol the old module exported, so the 120+ consumers need no change.
 */
export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  pendingReveal: null,
  ...createTabActions(set, get),
  ...createWorkspaceActions(set, get),
  ...createContentActions(set),
  ...createModeActions(set, get),
  ...createInputActions(set, get),
  ...createSaveActions(set, get),
  ...createCloseActions(set, get),
}));

// Public API re-exports — unchanged surface for the existing consumers.
export {
  createDefaultTab,
  isVariableInspectorSupportedLanguage,
  SQL_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_ID,
  UTILITIES_WORKSPACE_TAB_ID,
} from './editorTabUtils';
export { getActiveTab, getActiveTabIndex } from './editorSelectors';
export { languageFromPath } from '../utils/language';

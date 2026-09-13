/**
 * Renderer editor and tab-state contracts.
 *
 * Store actions, tab orchestration, and editor-facing helpers import this leaf
 * directly so changes to settings or console state do not widen their type
 * dependency surface.
 */

import type { RuntimeMode } from '../../shared/runtimeModes';
import type { WorkflowMode } from '../../shared/workflowMode';
import type { DeveloperUtilityId } from '../data/developerUtilityCatalog';
import type { Language } from './language';

/**
 * internal implementation follow-up — per-tab execution lifecycle.
 *
 * The tab bar surfaces these as a small status dot to the left of
 * the close button so the user can scan multiple tabs and tell
 * which one is running, which one finished cleanly, and which one
 * blew up. The `parseError` field is a lighter-weight signal: an
 * inline parse / lint failure that the runner surfaced as a
 * console entry. Resets to `null` when the user edits the buffer
 * (the parse position is no longer valid).
 *
 * Default state is `idle`. The execution path in `useRunner` flips
 * `running` on start, then `success` or `error` on resolution. The
 * editor store clears state back to `idle` on tab edit so a stale
 * red dot does not persist past a fix.
 */
export type TabExecutionState = 'idle' | 'running' | 'success' | 'error';

/** internal — a named, per-tab replayable stdin + argv snapshot. */
export interface InputSet {
  id: string;
  name: string;
  stdin: string;
  /** Optional command arguments, stored exactly one entry per argument. */
  args?: string[];
}

export interface FileTab {
  id: string;
  name: string;
  language: Language;
  content: string;
  isDirty: boolean;
  /**
   * Absolute path on disk for display (tooltip, tab title resolution,
   * sessionStore persistence). NEVER sent to a filesystem IPC handler
   * — every IPC operation on this file uses `{ rootId, relativePath }`
   * instead. Undefined for in-memory (unsaved) files.
   */
  filePath?: string;
  /**
   * internal capability binding. The `rootId` is a process-lifetime token
   * minted when the picker resolved this file (single-file open or
   * save-as) or when the file was opened from inside the active
   * project tree. `relativePath` is the file path inside that root.
   * Both are required to read or write the file; both are undefined
   * for untitled buffers and re-derived (via `fs:reopen-file`) when
   * the session-store restores a tab from a previous run.
   */
  rootId?: string;
  relativePath?: string;
  /** Last execution outcome. Drives the status dot in EditorTabs. */
  executionState?: TabExecutionState;
  /**
   * Last surfaced parse / runtime error message. Truncated by the
   * tab bar via `title` attribute; the editor store clears it on
   * the next content edit so a stale message does not linger.
   */
  parseError?: string | null;
  /**
   * implementation — explicit per-tab runtime mode for JS/TS tabs.
   * `'worker'` for all freshly created JS/TS tabs; `undefined` for
   * every other language. implementation surfaced `'browser-preview'` for
   * the iframe-isolated preview pane; implementation will surface `'node'`
   * once the desktop child-process backend lands.
   * See [`docs/RUNTIME_MODES_ADR.md`](../../docs/RUNTIME_MODES_ADR.md).
   */
  runtimeMode?: RuntimeMode;
  /**
   * implementation — explicit per-tab workflow mode. Three values:
   *
   *   - `scratchpad` — auto-run fires on debounced keystrokes
   *     (gated by the implementation completion heuristic). Default for
   *     Scratchpad-capable languages (JS / TS / Python today).
   *   - `run` — auto-run is OFF. Manual Cmd+R still works. Default
   *     for compiled / validate / view-only tabs and the fall-back
   *     for any language whose explicit mode is no longer
   *     supported after a language change.
   *   - `debug` — auto-run is OFF; the user intends to step
   *     through breakpoints. Only valid for languages with a
   *     debugger adapter (JS / TS everywhere, Python on desktop).
   *
   * Optional so legacy persisted tabs load cleanly — the
   * resolved selector falls through to
   * `defaultWorkflowMode(language)` when the field is absent.
   */
  workflowMode?: WorkflowMode;
  /**
   * implementation note — explicit per-tab auto-log override on
   * top of the per-language Settings default. Three resolved
   * states:
   *
   *   - `true` — auto-log fires on this tab even when the
   *     language default is OFF.
   *   - `false` — auto-log is silenced on this tab even when the
   *     language default is ON.
   *   - `undefined` — fall through to
   *     `scratchpadAutoLogByLanguage[language]`.
   *
   * Cleared in `renameTab` when the new language is not JS / TS so
   * a stale override does not persist across language changes.
   */
  autoLogEnabled?: boolean;
  /**
   * implementation — per-tab pre-set stdin buffer consumed by JS / TS
   * `prompt()` / `readline()` and Python `input()` during the next
   * run. Newline-delimited; each call to `prompt()` / `input()`
   * consumes one line. Empty / undefined ⇒ no patching, native worker
   * behavior. In JS workers that means a bare `prompt()` is still
   * undefined; after a non-empty buffer is exhausted the patched
   * `prompt()` / `readline()` returns `null`.
   * Cleared in `renameTab` when the new language has no worker-side
   * stdin support (anything outside JS / TS / Python).
   */
  stdinBuffer?: string;
  /** internal — named input snapshots saved with the editor session. */
  inputSets?: InputSet[];
  /** internal — the set currently loaded into `stdinBuffer` / `inputArgs`. */
  activeInputSetId?: string;
  /** internal — current argv draft; runners may consume it when supported. */
  inputArgs?: string[];
  /**
   * implementation note — one-shot extended-timeout override for
   * the NEXT run on this tab. Set by the command palette
   * "Run with extended timeout" entry. `executeTabManually` reads
   * the value, threads it onto `ExecutionContext.timeout`, and
   * clears the field immediately so a subsequent run reverts to
   * the persisted preset. Per-tab so switching tabs cannot
   * accidentally carry the override.
   */
  nextRunTimeoutOverrideMs?: number;
  /**
   * implementation — per-tab flag for the "Compare with last
   * stable run" toggle in the result-panel header. `true` swaps
   * the inline-results region for `<CompareResultsPanel>` when a
   * comparator snapshot is available; otherwise the toggle stays
   * dormant. Cleared on language change (rename / Save-As) via
   * `dropCompareIfLanguageChanged` so a JS-mode toggle doesn't
   * surface a stale comparator on a freshly-renamed Python tab.
   */
  compareWithSnapshotEnabled?: boolean;
  /**
   * implementation — per-tab flag for the "Variables" toggle in
   * the result-panel header. `true` swaps the inline-results
   * region for `<VariableInspectorPanel>` when a language-matching
   * `ScopeSnapshot` is available. Mutually exclusive with the
   * `Compare` toggle: the header forces one off when the other
   * comes on. Cleared on language change (rename / Save-As) when
   * the new language is not in the inspector's supported set
   * (`javascript` / `typescript` / `python`).
   */
  variableInspectorEnabled?: boolean;
  /**
   * implementation — when set, this tab was opened from the Recipes
   * overlay and the bottom-panel `'recipe'` sibling tab is gated on
   * this binding. The string is the `LessonPackV1.id` of the bundled
   * recipe. Cleared on language change to a non-recipe-runnable
   * target (see `dropRecipeBindingIfLanguageChanged` in editorStore)
   * and on explicit unbind via the `<RecipeRunPanel>` action. The
   * companion runtime state (last-run results, in-flight flag) lives
   * on `useRecipeStore` keyed by tab id.
   */
  recipeBindingId?: string;
  /**
   * implementation — when `'notebook'`, this tab renders
   * `<NotebookView>` instead of Monaco. The companion document
   * (cells + outputs + run status) lives in `useNotebookStore` keyed
   * by `tab.id`. The `content` field is unused for notebook tabs (the
   * cell sources are the source of truth); `language` is informational
   * only — per-cell language is the runner dispatch key.
   *
   * MOV.02 — widened to `'sql'` / `'http'`. MOV.03 adds
   * `'utilities'`. These ascend workspace surfaces from modal/dock
   * slots to full-screen workspace tabs that sit alongside Notebook.
   * As with `'notebook'`, the `content` field is unused: SQL/HTTP own
   * their collections in dedicated workspace stores, and Utilities
   * keeps active tool selection in `utilityWorkspaceStore` and
   * favorites/history in activation-scoped `utilityHistoryStore`.
   * `language` is a neutral marker (`'sql'` / `'http'` /
   * `'utilities'`) rather than a Monaco-runnable language so every
   * language-gated code path stays dormant.
   */
  kind?: 'notebook' | 'sql' | 'http' | 'utilities';
}

/**
 * Either `filePath` OR `tabId` pins the request to a target tab:
 *
 *   - `filePath` mode — used by Project Search and future open-from-link
 *     flows. The reveal is queued BEFORE the tab exists; CodeEditor applies
 *     it when the tab with that file path becomes active.
 *   - `tabId` mode — used by same-tab surfaces such as Go to Symbol, where
 *     the target tab is already mounted but may be unsaved (no filePath).
 *
 * When both are supplied, `tabId` wins since it's the tighter identity.
 */
export interface EditorRevealRequest {
  filePath?: string;
  tabId?: string;
  line: number;
  column?: number;
}

export interface EditorState {
  tabs: FileTab[];
  activeTabId: string | null;
  /**
   * Pending request to scroll the editor to a specific line/column once the
   * target file becomes the active tab. `null` when no reveal is queued.
   */
  pendingReveal: EditorRevealRequest | null;
  addTab: (tab: Omit<FileTab, 'isDirty'>) => void;
  /**
   * Grandfather an array of tabs into the store without consulting the
   * internal tier ceiling. Only the session-restore path should use this
   * so users' prior workspaces are never truncated by a Free downgrade.
   */
  restoreTabs: (tabs: Array<Omit<FileTab, 'isDirty'>>, activeTabId?: string | null) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /**
   * implementation note — switch a tab's language without
   * re-creating it. Used by the `.ipynb` import flow to flip a
   * freshly-imported notebook tab's language chip to the dominant
   * cell language. No-op on unknown tab, matching language, or
   * tier-blocked language.
   */
  setTabLanguage: (id: string, language: Language) => void;
  updateContent: (id: string, content: string) => void;
  /**
   * implementation — refresh a tab's buffer from disk content without
   * marking it dirty. Used by the Replace in files overlay so the
   * on-screen tab reflects the post-replace disk content. Cmd+Z does
   * not restore the previous content; replace-in-files is a
   * non-undoable operation per the confirmation modal copy.
   */
  setTabContentFromDisk: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  /**
   * internal — flip the per-tab lifecycle marker. Called by the runner
   * when execution starts (`running`), resolves cleanly (`success`),
   * or fails (`error`). `parseError` accepts an optional one-line
   * explanation that the tab bar surfaces via title tooltip on
   * error states.
   */
  setTabExecutionState: (id: string, state: TabExecutionState, parseError?: string | null) => void;
  /**
   * implementation — set the runtime mode for a JS/TS tab. No-op
   * (and a status-notice toast) when:
   *   - the tab does not own a runtime-mode surface (non-JS/TS), or
   *   - the requested mode is not yet implemented (`'node'` until
   *     implementation lands).
   * Telemetry (`runtime.mode_changed`) fires on every successful
   * change.
   */
  setTabRuntimeMode: (id: string, mode: RuntimeMode) => void;
  /**
   * implementation — set the workflow mode for a tab. No-op when:
   *   - the tab does not exist;
   *   - the language does not support the requested mode (e.g.
   *     `debug` on a Rust tab).
   * Telemetry (`runtime.workflow_mode_changed`) fires on every
   * successful change with `trigger: 'toolbar'`.
   */
  setTabWorkflowMode: (id: string, mode: WorkflowMode) => void;
  /**
   * implementation note — set the per-tab auto-log override.
   * `null` clears the override so the tab falls back to the
   * per-language Settings default. The mutation is a no-op if:
   *   - the tab does not exist;
   *   - the tab's language is not JS / TS / Python (the three worker-backed
   *     Scratchpad expression-capture paths).
   */
  setTabAutoLogEnabled: (id: string, enabled: boolean | null) => void;
  /**
   * implementation — write the per-tab stdin buffer. `null` clears
   * the field. No-op when:
   *   - the tab does not exist;
   *   - the tab's language is not JS / TS / Python (stdin is
   *     worker-only this change; the desktop runners stay TODO).
   */
  setTabStdinBuffer: (id: string, text: string | null) => void;
  /** internal — replace the active tab's argv draft (one array item per argument). */
  setTabInputArgs: (id: string, args: string[] | null) => void;
  /** internal — create/update a named snapshot from the tab's current input. */
  saveTabInputSet: (id: string, name: string) => string | null;
  /** internal — load a named snapshot, or detach into an unsaved draft with null. */
  selectTabInputSet: (id: string, inputSetId: string | null) => void;
  /** internal — rename an existing input snapshot. */
  renameTabInputSet: (id: string, inputSetId: string, name: string) => boolean;
  /** internal — remove a snapshot without clearing the currently loaded values. */
  deleteTabInputSet: (id: string, inputSetId: string) => void;
  /**
   * implementation note — set / clear the one-shot extended-timeout
   * override for the next run on the given tab. `executeTabManually`
   * consumes the value once and clears it. `null` clears the field
   * without consuming.
   */
  setTabNextRunTimeoutOverride: (id: string, timeoutMs: number | null) => void;
  /**
   * implementation — write the per-tab `compareWithSnapshotEnabled`
   * flag. `null` clears the field (toggle returns to disabled).
   * No-op when the tab does not exist.
   */
  setTabCompareEnabled: (id: string, enabled: boolean | null) => void;
  /**
   * implementation — write the per-tab `variableInspectorEnabled`
   * flag. `null` clears the field (toggle returns to disabled).
   * Mutual exclusion with `setTabCompareEnabled` is enforced at the
   * caller level — toggling Variables on flips Compare off, and
   * vice versa.
   */
  setTabVariableInspectorEnabled: (id: string, enabled: boolean | null) => void;
  /**
   * implementation — clear the per-tab recipe binding. Used by the
   * Recipe panel's explicit unbind action so the persisted
   * session-store copy cannot resurrect the panel after reload.
   */
  clearRecipeBinding: (id: string) => void;
  /**
   * implementation — create a fresh notebook tab. Wraps `addTab` with
   * `kind: 'notebook'` + seeds the companion `useNotebookStore`
   * entry. `language` is the notebook-level display/default cell
   * language used when an importer knows the dominant code-cell
   * language. Returns the new tab id on success, `null` if the tab
   * budget is exhausted or the entitlement gate denies.
   */
  addNotebookTab: (opts?: { title?: string; language?: Language }) => string | null;
  /**
   * SQL/HTTP MODEL rework — focus (or create) the SINGLE SQL workspace
   * tab. The SQL surface is a TablePlus-style COLLECTION workspace, so
   * there is at most ONE SQL tab (stable id `SQL_WORKSPACE_TAB_ID`),
   * never one tab per query. The collection of queries lives in
   * `useWorkspaceSqlStore`, navigated by the in-panel rail. Workspace
   * tabs are exempt from the Free tab budget, so this always succeeds
   * and returns the stable workspace tab id.
   */
  addSqlTab: () => string | null;
  /**
   * SQL/HTTP MODEL rework — focus (or create) the SINGLE HTTP workspace
   * tab. Mirror of `addSqlTab`: an Insomnia/Postman-style COLLECTION
   * workspace (stable id `HTTP_WORKSPACE_TAB_ID`), not one tab per
   * request. The collection lives in `useWorkspaceToolStore`, navigated
   * by the rail. Always succeeds; returns the stable workspace tab id.
   */
  addHttpTab: () => string | null;
  /**
   * MOV.03 — focus (or create) the single Developer Utilities
   * workspace tab. The selected utility id is owned by
   * `utilityWorkspaceStore` / `utilityHistoryStore`, so this tab is only the
   * full-screen shell.
   */
  addUtilitiesTab: (utilityId?: DeveloperUtilityId) => string | null;
  /**
   * Open a file from disk via a capability token. If a tab with the
   * same `(rootId, relativePath)` is already open, activate it. The
   * optional `displayPath` is shown to the user (tooltips, session
   * restore) but is never echoed back to an IPC handler.
   */
  openFile: (
    rootId: string,
    relativePath: string,
    name: string,
    language: Language,
    displayPath?: string
  ) => Promise<void>;
  /** Open a native file picker and open the selected file in a new tab. */
  openFileFromDisk: () => Promise<void>;
  /** Save the active tab's content to disk (only if it has a filePath). */
  saveActiveTab: () => Promise<void>;
  /** Show a Save As dialog and save the active tab to the chosen path. */
  saveActiveTabAs: () => Promise<void>;
  /**
   * Persist a specific tab, optionally forcing a Save As dialog even when the
   * tab already has a file path. Returns false when the user cancels Save As.
   */
  saveTabById: (id: string, forceSaveAs?: boolean) => Promise<boolean>;
  /** Close a tab with dirty-check prompt. Returns true if closed. */
  closeTab: (id: string) => Promise<boolean>;
  /** Duplicate the active tab into a new unsaved tab. */
  duplicateActiveTab: () => void;
  /**
   * Rename a tab in place. Re-resolves the Monaco language from the
   * new extension and marks the tab dirty so the divergence with disk
   * is visible until the user saves.
   */
  renameTab: (id: string, name: string) => void;
  /**
   * Bulk close-helpers used by the tab context menu. Each one funnels
   * through `closeTab` per-tab so the existing dirty-check prompt
   * fires for unsaved tabs in the batch.
   */
  closeOtherTabs: (id: string) => Promise<void>;
  closeTabsToRight: (id: string) => Promise<void>;
  closeAllTabs: () => Promise<void>;
  /**
   * Queue a scroll + caret move that the CodeEditor applies once the target
   * file is the active tab. Latest request wins so rapid clicks in Project
   * Search do not leave the editor ping-ponging between positions.
   */
  requestReveal: (target: EditorRevealRequest) => void;
  /** Clear any pending reveal. The CodeEditor calls this after applying it. */
  clearPendingReveal: () => void;
}

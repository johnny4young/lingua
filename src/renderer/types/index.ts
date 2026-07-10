import type { ShortcutCombo, ShortcutOverrideMap } from '../data/keyboardShortcuts';
import type { DeveloperUtilityId } from '../data/developerUtilities';
import type { RuntimeMode } from '../../shared/runtimeModes';
import type { WorkflowMode } from '../../shared/workflowMode';
import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
import type { ScopeSnapshot } from '../../shared/scopeSnapshot';
import type { RichOutputPayload } from '../../shared/richOutput';
import type { ScorecardPlatform } from '../../shared/languageSupport';

export type { RuntimeTimeoutPreset };
export type { ScopeSnapshot };
export type { RichOutputPayload };

export type AppLanguage = 'system' | 'en' | 'es';

export type BuiltInLanguage =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'python'
  | 'rust'
  | 'ruby'
  | 'c'
  | 'cpp'
  | 'swift'
  | 'kotlin'
  | 'java'
  | 'scala'
  | 'json'
  | 'yaml'
  | 'dotenv'
  | 'toml'
  | 'ini'
  | 'csv'
  | 'dockerfile'
  | 'makefile'
  | 'gitignore'
  | 'editorconfig'
  | 'shellscript';

/**
 * Language ids used across the editor.
 * Plugins may introduce additional string identifiers beyond the built-ins.
 */
export type Language = BuiltInLanguage | (string & {});

/**
 * RL-070 Sub-slice 6 follow-up — per-tab execution lifecycle.
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
   * RL-077 capability binding. The `rootId` is a process-lifetime token
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
   * RL-019 Slice 1 — explicit per-tab runtime mode for JS/TS tabs.
   * `'worker'` for all freshly created JS/TS tabs; `undefined` for
   * every other language. Slice 3 surfaced `'browser-preview'` for
   * the iframe-isolated preview pane; Slice 2 will surface `'node'`
   * once the desktop child-process backend lands.
   * See [`docs/RUNTIME_MODES_ADR.md`](../../docs/RUNTIME_MODES_ADR.md).
   */
  runtimeMode?: RuntimeMode;
  /**
   * RL-020 Slice 2 — explicit per-tab workflow mode. Three values:
   *
   *   - `scratchpad` — auto-run fires on debounced keystrokes
   *     (gated by the Slice 1 completion heuristic). Default for
   *     Scratchpad-capable languages (JS / TS / Python today).
   *   - `run` — auto-run is OFF. Manual Cmd+R still works. Default
   *     for compiled / validate / view-only tabs and the fall-back
   *     for any language whose explicit mode is no longer
   *     supported after a language change.
   *   - `debug` — auto-run is OFF; the user intends to step
   *     through breakpoints. Only valid for languages with a
   *     debugger adapter (JS / TS today).
   *
   * Optional so pre-Slice-2 persisted tabs load cleanly — the
   * resolved selector falls through to
   * `defaultWorkflowMode(language)` when the field is absent.
   */
  workflowMode?: WorkflowMode;
  /**
   * RL-020 Slice 5 fold C — explicit per-tab auto-log override on
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
   * RL-020 Slice 6 — per-tab pre-set stdin buffer consumed by JS / TS
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
  /**
   * RL-020 Slice 7 fold D — one-shot extended-timeout override for
   * the NEXT run on this tab. Set by the command palette
   * "Run with extended timeout" entry. `executeTabManually` reads
   * the value, threads it onto `ExecutionContext.timeout`, and
   * clears the field immediately so a subsequent run reverts to
   * the persisted preset. Per-tab so switching tabs cannot
   * accidentally carry the override.
   */
  nextRunTimeoutOverrideMs?: number;
  /**
   * RL-020 Slice 8 — per-tab flag for the "Compare with last
   * stable run" toggle in the result-panel header. `true` swaps
   * the inline-results region for `<CompareResultsPanel>` when a
   * comparator snapshot is available; otherwise the toggle stays
   * dormant. Cleared on language change (rename / Save-As) via
   * `dropCompareIfLanguageChanged` so a JS-mode toggle doesn't
   * surface a stale comparator on a freshly-renamed Python tab.
   */
  compareWithSnapshotEnabled?: boolean;
  /**
   * RL-020 Slice 9 — per-tab flag for the "Variables" toggle in
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
   * RL-039 Slice B — when set, this tab was opened from the Recipes
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
   * RL-043 Slice A — when `'notebook'`, this tab renders
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
   * keeps its active tool/favorites/history in `utilityHistoryStore`.
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
   * RL-060 tier ceiling. Only the session-restore path should use this
   * so users' prior workspaces are never truncated by a Free downgrade.
   */
  restoreTabs: (tabs: Array<Omit<FileTab, 'isDirty'>>, activeTabId?: string | null) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /**
   * RL-100 Slice 2 fold F — switch a tab's language without
   * re-creating it. Used by the `.ipynb` import flow to flip a
   * freshly-imported notebook tab's language chip to the dominant
   * cell language. No-op on unknown tab, matching language, or
   * tier-blocked language.
   */
  setTabLanguage: (id: string, language: Language) => void;
  updateContent: (id: string, content: string) => void;
  /**
   * RL-024 Slice 2 — refresh a tab's buffer from disk content without
   * marking it dirty. Used by the Replace in files overlay so the
   * on-screen tab reflects the post-replace disk content. Cmd+Z does
   * not restore the previous content; replace-in-files is a
   * non-undoable operation per the confirmation modal copy.
   */
  setTabContentFromDisk: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  /**
   * RL-070 — flip the per-tab lifecycle marker. Called by the runner
   * when execution starts (`running`), resolves cleanly (`success`),
   * or fails (`error`). `parseError` accepts an optional one-line
   * explanation that the tab bar surfaces via title tooltip on
   * error states.
   */
  setTabExecutionState: (id: string, state: TabExecutionState, parseError?: string | null) => void;
  /**
   * RL-019 Slice 1 — set the runtime mode for a JS/TS tab. No-op
   * (and a status-notice toast) when:
   *   - the tab does not own a runtime-mode surface (non-JS/TS), or
   *   - the requested mode is not yet implemented (`'node'` until
   *     Slice 2 lands).
   * Telemetry (`runtime.mode_changed`) fires on every successful
   * change.
   */
  setTabRuntimeMode: (id: string, mode: RuntimeMode) => void;
  /**
   * RL-020 Slice 2 — set the workflow mode for a tab. No-op when:
   *   - the tab does not exist;
   *   - the language does not support the requested mode (e.g.
   *     `debug` on a Rust tab).
   * Telemetry (`runtime.workflow_mode_changed`) fires on every
   * successful change with `trigger: 'toolbar'`.
   */
  setTabWorkflowMode: (id: string, mode: WorkflowMode) => void;
  /**
   * RL-020 Slice 5 fold C — set the per-tab auto-log override.
   * `null` clears the override so the tab falls back to the
   * per-language Settings default. The mutation is a no-op if:
   *   - the tab does not exist;
   *   - the tab's language is not JS / TS (auto-log is JS/TS-only
   *     this slice; setting the flag elsewhere would be misleading).
   */
  setTabAutoLogEnabled: (id: string, enabled: boolean | null) => void;
  /**
   * RL-020 Slice 6 — write the per-tab stdin buffer. `null` clears
   * the field. No-op when:
   *   - the tab does not exist;
   *   - the tab's language is not JS / TS / Python (stdin is
   *     worker-only this slice; the desktop runners stay TODO).
   */
  setTabStdinBuffer: (id: string, text: string | null) => void;
  /**
   * RL-020 Slice 7 fold D — set / clear the one-shot extended-timeout
   * override for the next run on the given tab. `executeTabManually`
   * consumes the value once and clears it. `null` clears the field
   * without consuming.
   */
  setTabNextRunTimeoutOverride: (id: string, timeoutMs: number | null) => void;
  /**
   * RL-020 Slice 8 — write the per-tab `compareWithSnapshotEnabled`
   * flag. `null` clears the field (toggle returns to disabled).
   * No-op when the tab does not exist.
   */
  setTabCompareEnabled: (id: string, enabled: boolean | null) => void;
  /**
   * RL-020 Slice 9 — write the per-tab `variableInspectorEnabled`
   * flag. `null` clears the field (toggle returns to disabled).
   * Mutual exclusion with `setTabCompareEnabled` is enforced at the
   * caller level — toggling Variables on flips Compare off, and
   * vice versa.
   */
  setTabVariableInspectorEnabled: (id: string, enabled: boolean | null) => void;
  /**
   * RL-039 Slice B — clear the per-tab recipe binding. Used by the
   * Recipe panel's explicit unbind action so the persisted
   * session-store copy cannot resurrect the panel after reload.
   */
  clearRecipeBinding: (id: string) => void;
  /**
   * RL-043 Slice A — create a fresh notebook tab. Wraps `addTab` with
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
   * `utilityHistoryStore`, so this tab is only the full-screen shell.
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

export type ConsoleEntryType = 'log' | 'warn' | 'error' | 'info' | 'result';

export interface ConsoleEntry {
  id: string;
  type: ConsoleEntryType;
  content: string;
  timestamp: number;
  line?: number;
  /** Source language for telemetry on payload-level interactions. */
  language?: Language;
  /** Execution time in ms — shown as a badge when set (only on the last entry) */
  executionTime?: number;
  /**
   * RL-044 Slice 1B — rich payload aligned with the legacy `content` string.
   * One entry per console-arg; absent on non-JS runners and on the text
   * fallback path. The renderer must always tolerate missing payload.
   */
  payload?: RichOutputPayload[];
  /**
   * RL-123 / AUDIT-03 — content-equality hash of type + line + content +
   * payload shape, computed once at push time.
   * The store uses it to collapse consecutive identical entries without
   * re-running `JSON.stringify` on every render. Optional because callers
   * outside `consoleStore.addEntry` and test fixtures may omit it; store-created
   * entries always receive one before they can participate in `collapsedEntries`.
   */
  equalityHash?: string;
}

/**
 * RL-123 / AUDIT-03 — one visible console row after consecutive identical
 * entries are collapsed. Derived store-side at push time (not on render);
 * `repeatCount >= 2` surfaces the ×N badge. `entry` is the first member of
 * the run and carries its `equalityHash` for the next push's comparison.
 */
export interface CollapsedConsoleRow {
  entry: ConsoleEntry;
  repeatCount: number;
}

export type ConsolePayloadKindBucket =
  | 'table'
  | 'object'
  | 'array'
  | 'mapSet'
  | 'date'
  | 'promise'
  | 'text'
  | 'rawText'
  | 'image'
  | 'chart'
  // RL-044 Slice 1C fold F — Python `BaseException` payloads ship
  // `kind: 'error'`. The renderer chip family already had an
  // `'errorish'` filter for warn/error entry types; this is the
  // distinct payload-level bucket.
  | 'error'
  // RL-044 Slice 2a — sandboxed HTML payloads.
  | 'html';

export type ConsolePayloadKindFilter = ConsolePayloadKindBucket | 'errorish';

/**
 * UX Sweep T2 fold B — the slice of console state that `clear()` wipes,
 * captured so the Undo toast can put it back without losing rows that
 * arrived after the clear. Holds the three fields `clear()` resets
 * (`entries`, `collapsedEntries`, `hiddenPayloadKinds`); the filter set
 * and timestamp toggle are not touched by clear and so are not part of
 * the snapshot.
 */
export interface ConsoleClearSnapshot {
  entries: ConsoleEntry[];
  collapsedEntries: CollapsedConsoleRow[];
  hiddenPayloadKinds: Set<ConsolePayloadKindFilter>;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  /**
   * RL-123 / AUDIT-03 — consecutive identical entries collapsed once at
   * push time. The console renders (and then filters) these rows instead
   * of recomputing the collapse + `JSON.stringify` equality on every
   * render. Collapsed groups are homogeneous (same type + content +
   * payload), so filtering the rows yields the same visible result as
   * filtering the raw entries first.
   */
  collapsedEntries: CollapsedConsoleRow[];
  /** Which entry types are currently visible */
  activeFilters: Set<ConsoleEntryType>;
  /**
   * RL-044 Slice 1B fold A — which payload-kind chips are dimmed-out.
   * Empty set = all visible. We track *hidden* kinds so the default
   * (no filter applied) does not require pre-populating every kind.
   */
  hiddenPayloadKinds: Set<ConsolePayloadKindFilter>;
  showTimestamps: boolean;
  addEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => void;
  clear: () => void;
  /**
   * UX Sweep T2 fold B — re-instate a {@link ConsoleClearSnapshot} that
   * `clear()` previously wiped, for the Undo toast. Rows emitted after the
   * clear are appended after the restored snapshot instead of being
   * dropped, so Undo cannot erase new runtime output. No-op-safe:
   * restoring an empty snapshot keeps any current rows.
   */
  restore: (snapshot: ConsoleClearSnapshot) => void;
  toggleFilter: (type: ConsoleEntryType) => void;
  togglePayloadKindFilter: (kind: ConsolePayloadKindFilter) => void;
  clearPayloadKindFilters: () => void;
  toggleTimestamps: () => void;
}

export type LayoutPreset = 'horizontal' | 'vertical' | 'editor-only';

/**
 * RL-111 — boot-time session-restore policy. Replaces the legacy
 * `restoreSession: boolean`. Three closed states:
 *
 *   - `never`   — ignore the persisted session snapshot; always boot fresh.
 *   - `ask`     — if the snapshot holds ≥1 tab, surface a clickable
 *                 "Restore N tabs" prompt; restore only on click. Default
 *                 for fresh installs, and the privacy-conscious middle
 *                 ground (reopening after screen-sharing does not auto-
 *                 surface private code).
 *   - `always`  — restore the snapshot silently on boot (the legacy
 *                 `restoreSession: true` behavior).
 *
 * The v1→v2 settings migration maps legacy `false → 'ask'` (fold B —
 * everyone gets the better default) and `true → 'always'`.
 */
export type RestoreSessionMode = 'never' | 'ask' | 'always';

export interface SettingsState {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontSize: number;
  fontFamily: string;
  wordWrap: boolean;
  minimap: boolean;
  layoutPreset: LayoutPreset;
  maxLoopIterations: number;
  restoreSessionMode: RestoreSessionMode;
  /** RL-095 Slice 2 — sticky Web/Desktop filter on the Language Support Scorecard. */
  languageScorecardPlatform: ScorecardPlatform;
  formatOnSave: boolean;
  /**
   * RL-110 — master toggle for smart paste detection. When `true` (default),
   * pasting a recognized artifact (share-link, capsule, cURL, stack frame,
   * large JSON) into the editor surfaces a non-blocking import toast. When
   * `false`, every paste is literal. Cmd+Shift+V bypasses detection for a
   * single paste regardless of this flag.
   */
  smartPasteDetectionEnabled: boolean;
  /**
   * RL-037 Vim mode flag. When `true`, the editor lazy-loads
   * `monaco-vim` and attaches Vim keybindings to the active Monaco
   * editor.
   */
  vimMode: boolean;
  /**
   * RL-079 — once-per-install acknowledgement for the trust-boundary
   * modal that appears before the first Go/Rust native execution.
   * Persisted so the user only sees the warning until they accept;
   * resettable from Settings → Account → Privacy.
   */
  nativeExecutionAcknowledged: boolean;
  /**
   * RL-028 sixth slice — opt-in code snapshot for the execution-history
   * ring buffer. When true (and the active tier covers
   * `EXECUTION_HISTORY`), each successful or failed run records the
   * source code at execution time so a follow-up slice can offer
   * Replay / Comparison. Snapshots stay in memory only — never
   * persisted, never sent over the network. Defaults to `true` for
   * Pro users; the runtime gate in `executeTabManually` enforces the
   * tier check independently of the toggle so a state-shadowing bug
   * cannot leak captures to Free users.
   */
  executionHistorySnapshotEnabled: boolean;
  /**
   * Telemetry opt-in. Three states so we can distinguish "user explicitly
   * declined" from "user has not seen the prompt yet", and keep the prompt
   * from re-appearing after a decline.
   */
  telemetryConsent: 'unset' | 'granted' | 'declined';
  /**
   * RL-069 Slice 3 — clipboard-on-focus apply consent. Default `unset`,
   * promoted to `granted` or `declined` by the explicit Settings toggle.
   * The same three-state pattern as `telemetryConsent` so a decline
   * sticks across reloads and the feature never reads without opt-in.
   */
  utilitiesClipboardOnFocusConsent: 'unset' | 'granted' | 'declined';
  /**
   * RL-094 Slice 2 fold C — capsule-import clipboard auto-detect
   * consent. When the user opens the Capsule Import overlay (e.g.
   * Mod+Shift+Y), if this consent is `granted` and the system
   * clipboard contains a valid capsule JSON, the overlay pre-fills
   * the paste area. `'unset'` shows an opt-in row in the overlay
   * itself; `'declined'` keeps the clipboard untouched. Local-only;
   * the helper never reads the clipboard without explicit opt-in,
   * mirroring `utilitiesClipboardOnFocusConsent`.
   */
  capsuleImportClipboardOnFocusConsent: 'unset' | 'granted' | 'declined';
  /**
   * RL-100 Slice 1 fold F — import-preview clipboard auto-detect
   * consent. Slice 1 lands the field on the store + sanitized
   * rehydrate (no Settings UI surface yet); Slice 2 wires the
   * actual auto-detect on overlay focus, mirroring the capsule
   * import flow.
   */
  importPreviewClipboardOnFocusConsent: 'unset' | 'granted' | 'declined';
  /**
   * RL-025 Slice A — master toggle for the dependency detection
   * pipeline + bottom-panel Dependencies tab. Default depends on
   * tier at first rehydrate (fold G): Free → `false` so the
   * disabled Install button never reads as upsell pressure; Pro /
   * Team / Education / Trial → `true` so the panel discovers
   * itself on the next paste. Persisted, so once the user flips it
   * the choice survives. Flipping it OFF clears the per-tab cache
   * so the panel hides immediately, not after the next edit.
   */
  dependencyDetectionEnabled: boolean;
  /**
   * RL-019 Slice 1 fold B — default JS/TS runtime mode for newly
   * created tabs. `'worker'` mirrors `defaultRuntimeModeFor()` and
   * stays the only implemented option until Slice 2 lands. Settings
   * → Editor exposes the selector; the value is per-app, not
   * per-tab (each tab keeps its own choice).
   */
  defaultRuntimeMode: RuntimeMode;
  /**
   * RL-020 Slice 2 — per-language workflow-mode defaults applied to
   * NEWLY CREATED tabs. Existing tabs keep their explicit choice;
   * this map only governs new-tab seeding via `createDefaultTab`.
   * Missing keys fall through to the shared
   * `defaultWorkflowMode(language)` helper, so a sparse map is
   * sufficient — fold C migration seeds the three Scratchpad
   * languages on upgrade so the Settings UI surfaces them visibly.
   */
  workflowModeDefaultsByLanguage: Record<string, WorkflowMode>;
  /**
   * RL-020 Slice 5 — per-language opt-in for the bare-expression
   * auto-log mode. Keys are `'javascript'` and `'typescript'` (the
   * two languages whose worker runner threads the auto-log
   * transform). Other keys are stripped on rehydrate; non-boolean
   * values are coerced to `false`. Per-tab overrides via
   * `FileTab.autoLogEnabled` (fold C) win over this default.
   */
  scratchpadAutoLogByLanguage: Record<string, boolean>;
  /**
   * RL-108 — per-language inline-lint enablement. Keyed by language id;
   * Slice 1 ships `javascript`/`typescript` ON. When `false` for a language,
   * Monaco's built-in TS/JS squiggles are silenced (via
   * `setMonacoInlineLintEnabled`) and the custom `'lingua-lint'` markers are
   * cleared for that language. Unknown keys are stripped on rehydrate;
   * non-boolean values coerce to the seed default.
   */
  inlineLintEnabledByLanguage: Record<string, boolean>;
  /**
   * RL-020 Slice 6 fold D — master visibility toggle for the
   * bottom-panel `stdin` tab. Default `true` (the tab is offered
   * for JS / TS / Python tabs). When `false`, the BottomPanel
   * strip skips the entry entirely, so users who never use stdin
   * keep the leaner three-tab strip.
   */
  showStdinPanel: boolean;
  /**
   * RL-112 — master visibility toggle for the persistent bottom status
   * bar (language, problems, cursor position, encoding, indent, Git
   * branch, run status). Default ON desktop / OFF web. When `false` the
   * bar is fully unmounted (not just hidden), so it costs nothing for
   * users who never want it.
   */
  showStatusBar: boolean;
  /**
   * RL-093 Slice 3 — controls whether the variable inspector renders as
   * a draggable `<FloatingVariablesCard>` (default) or as a Variables
   * tab inside the bottom panel. Per-tab `variableInspectorEnabled`
   * still gates visibility on both surfaces; this picks where it
   * appears when enabled.
   */
  variableInspectorSurface: 'floating' | 'bottom';
  /**
   * RL-020 Slice 7 — per-language execution timeout preset. Keys are
   * the four languages whose runners read the preset
   * (`javascript`, `typescript`, `python`, `go`). Values are the
   * closed-enum `RuntimeTimeoutPreset` tokens. Unknown keys / values
   * are stripped on rehydrate. Rust is intentionally absent — its
   * desktop child-process kill path lives in main and is unchanged.
   */
  runtimeTimeoutPresetByLanguage: Record<string, RuntimeTimeoutPreset>;
  /**
   * RL-020 Slice 7 fold E — show a live `mm:ss` countdown in the
   * result-panel pill while a run is in flight. Default `false` so
   * the panel stays quiet by default; users who want the visual cue
   * during long runs opt in via Settings → Editor.
   */
  showTimeoutCountdown: boolean;
  /**
   * RL-020 Slice 9 fold G — Settings → Editor master toggle that
   * decides whether new tabs default to having the Variables panel
   * armed. Per-tab `variableInspectorEnabled` always wins when set;
   * this is just the seed for tabs that have not been touched.
   * Default OFF — the inspector is opt-in like auto-log.
   */
  showVariableInspectorByDefault: boolean;
  /**
   * RL-020 Slice 9 fold E — recursion depth the workers walk when
   * serializing the scope. `1` is the base scope; `4` is the
   * shared module's cap. Default `1`. Bumping this trades worker
   * time for richer panel data — the user can change it from
   * Settings → Editor.
   */
  variableInspectorScopeDepth: number;
  /**
   * RL-042 Slice 6 — Ruby runtime dispatcher preference. `auto` (the
   * default) prefers the system `ruby` binary when detected and falls
   * back to the bundled `@ruby/wasm-wasi` worker otherwise. `system`
   * forces the desktop subprocess (still falls back to WASM with a
   * status notice if the binary is missing). `wasm` always uses the
   * worker, even on desktop. Web builds ignore `system` / `auto` and
   * always run WASM because the bridge is missing.
   */
  rubyRuntimePreference: 'auto' | 'system' | 'wasm';
  /**
   * RL-019 Slice 2 fold E — one-shot dismissal flag for the
   * "Node mode runs your code with full filesystem and network
   * access" trust notice. Set the first time the user successfully
   * runs a Node-mode tab; the notice does not re-surface on
   * subsequent runs. Resettable from Settings if a future slice
   * surfaces the toggle.
   */
  nodeRunnerFirstRunNoticeShown: boolean;
  /**
   * RL-020 Slice 2 fold F — one-shot acknowledgement flag for the
   * "Scratchpad auto-runs as you type; Run waits for Cmd+R"
   * onboarding toast. Set to `true` the first time the user switches
   * a tab away from Scratchpad; the toast never re-fires after that.
   * Resettable from Settings → Account → Privacy (next slice) so
   * users can re-trigger the tour on a fresh install.
   */
  firstWorkflowModeSwitchAcknowledged: boolean;
  /**
   * RL-101 Slice 1 — onboarding choreography one-shot flags. Each
   * flag flips to `true` the first time its stage fires; resettable
   * from Settings → General → Onboarding so users can replay any
   * stage. Default `false` so a fresh install sees the full
   * sequence.
   */
  hasCompletedOnboardingWelcome: boolean;
  hasCompletedOnboardingFirstRun: boolean;
  hasCompletedOnboardingFirstSnippet: boolean;
  /**
   * RL-101 fold E — seed-version tracker for the welcome scratchpad.
   * Bumping `SEEDED_SCRATCHPAD_VERSION` on a future demo improvement
   * re-arms the seed for users whose persisted value is older,
   * regardless of `hasCompletedOnboardingWelcome`.
   */
  onboardingWelcomeSeedVersion: number;
  /**
   * App locale preference. `'system'` delegates to browser/OS locale; concrete
   * values pin the UI language and are mirrored through i18next on boot.
   */
  language: AppLanguage;
  /**
   * Last product version for the "what's new" surface. `null` means the user
   * has not acknowledged any release note version yet.
   */
  lastSeenVersion: string | null;
  /**
   * True once the legacy guided tour reaches its final step. Kept separate from
   * `suppressTourAutoStart` so a skipped tour can be re-enabled later.
   */
  hasCompletedTour: boolean;
  /**
   * When true, the guided tour is never auto-started on app launch. Set when
   * the user ticks "Don't show again" inside a tour step, or toggles the
   * matching switch in Settings. `hasCompletedTour` still tracks whether the
   * tour ran to the end — the two flags are intentionally independent so a
   * user who skipped can re-enable auto-start later.
   */
  suppressTourAutoStart: boolean;
  /**
   * User-defined keyboard shortcut overrides keyed by shortcut id. Missing
   * entries fall back to the catalog defaults in `keyboardShortcuts.ts`.
   * Theme preset import/export intentionally does NOT touch this map — the
   * same rationale that keeps loopProtection/restoreSessionMode out of presets.
   */
  shortcutOverrides: ShortcutOverrideMap;
  /**
   * Currently-applied keymap preset id. `default` means "no preset", i.e. the
   * catalog defaults (plus any ad-hoc overrides the user recorded). Selecting
   * a non-default preset REPLACES ad-hoc overrides with the preset's bundle.
   */
  keymapPreset: string;
  /**
   * Currently-applied theme pack id. `default` means "no pack", i.e. the
   * Lingua ship defaults. Applying a pack replaces appearance/typography/
   * layout fields wholesale; any manual edit afterwards flips this back
   * to `default` so the selector doesn't lie about the active state.
   */
  themePack: string;
  /**
   * RL-097 Slice 1 — Sensitive HTTP header allowlist. Names listed
   * here are redacted in the HTTP workspace response history + on
   * exported capsules. The baseline list
   * (`BASELINE_SENSITIVE_HEADERS` in `src/shared/httpWorkspace.ts`)
   * always applies regardless of this allowlist — users can ADD
   * names, not REMOVE the baselines. Lowercased + trimmed on
   * sanitize-on-rehydrate; non-string entries and empty strings are
   * dropped silently.
   */
  sensitiveHttpHeaders: string[];
  /**
   * RL-097 Slice 2 — SQL workspace row preview cap. Sets the upper
   * bound on rows rendered in `<SqlResultPreview>`. The runtime
   * also caps at `MAX_RESULT_ROWS` (10 000) regardless; this knob
   * lets users dial the panel further down (100 / 500 / 1000 /
   * 5000) for smaller screens. Default 1000.
   */
  sqlWorkspaceRowDisplayLimit: 100 | 500 | 1000 | 5000;
  /**
   * RL-097 Slice 2 — SQL query default timeout. DuckDB-WASM has no
   * native abort, so the runtime layer races a Promise against this
   * timeout. Default 30 s, capped at `MAX_QUERY_TIMEOUT_MS` (5 min)
   * by the runtime regardless of this value.
   */
  sqlWorkspaceQueryTimeoutMs: number;
  /**
   * RL-097 Slice 3 (SQL OPFS) — opt into persisting the SQL workspace
   * DuckDB database to this browser's OPFS so tables + rows survive a
   * reload. Default `false` (the workspace is an in-memory scratchpad).
   * The runtime falls back to in-memory whenever OPFS is unavailable,
   * so a `true` value here is a *request*, not a guarantee. Takes effect
   * on the next reload or via the Settings "Reconnect now" action.
   */
  sqlWorkspacePersistTables: boolean;
  /**
   * IT2-C1 — opt into the local Run Ledger: manual runs recorded into
   * the `lingua_ledger` schema of the SQL workspace's DuckDB database
   * (source is stored as a SHA-256 hash only; stdout previews come from
   * redacted capsules). Default `false`; durability across reloads
   * additionally requires the OPFS opt-in above, otherwise the ledger
   * lives for the session only.
   */
  runLedgerEnabled: boolean;
  /**
   * RL-043 Slice C fold D — language seeded into a new notebook code
   * cell by the "Add code" toolbar button. Only the two runnable cell
   * languages are offered; defaults to `'javascript'`.
   */
  notebookDefaultCellLanguage: 'javascript' | 'typescript';
  setTheme: (theme: 'dark' | 'light') => void;
  setEditorTheme: (theme: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  setMaxLoopIterations: (max: number) => void;
  setRestoreSessionMode: (mode: RestoreSessionMode) => void;
  /** RL-095 Slice 2 — set the scorecard's Web/Desktop platform filter. */
  setLanguageScorecardPlatform: (platform: ScorecardPlatform) => void;
  toggleFormatOnSave: () => void;
  /** RL-110 — flip the smart-paste detection master toggle. */
  toggleSmartPasteDetection: () => void;
  toggleVimMode: () => void;
  /** RL-079 — flip the native-execution acknowledgement flag. */
  setNativeExecutionAcknowledged: (value: boolean) => void;
  toggleExecutionHistorySnapshot: () => void;
  setTelemetryConsent: (next: 'granted' | 'declined') => void;
  /** RL-069 Slice 3 — flip clipboard-on-focus consent (granted/declined). */
  setUtilitiesClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /**
   * RL-094 Slice 2 fold C — flip capsule-import clipboard consent.
   * Same `'granted' | 'declined'` discipline as the utilities consent
   * so a single Settings setter never widens the closed enum.
   */
  setCapsuleImportClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /**
   * RL-100 Slice 1 fold F — set the import-preview clipboard consent.
   * Closed enum mirrors the capsule-import + utilities setters.
   */
  setImportPreviewClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /** RL-025 Slice A — flip the dependency detection master switch. */
  toggleDependencyDetectionEnabled: () => void;
  /**
   * RL-101 Slice 1 — three reset setters wired to the Settings →
   * General → Onboarding row toggles, the `Mod+Shift+W` shortcut
   * (fold D), and the palette commands (fold G). Each flips the
   * corresponding `hasCompletedOnboarding*` flag back to `false`.
   * `resetOnboardingWelcome` additionally resets
   * `onboardingWelcomeSeedVersion` so the latest seed is re-applied.
   */
  resetOnboardingWelcome: () => void;
  resetOnboardingFirstRun: () => void;
  resetOnboardingFirstSnippet: () => void;
  /**
   * RL-101 Slice 1 — stage-completion setters. Called by
   * `useOnboardingChoreography` after each toast fires so the
   * stage never repeats. `markOnboardingWelcomeCompleted` also
   * stamps the seed-version tracker.
   */
  markOnboardingWelcomeCompleted: (seedVersion: number) => void;
  markOnboardingFirstRunCompleted: () => void;
  markOnboardingFirstSnippetCompleted: () => void;
  /**
   * Apply a theme preset (editor theme, shell theme, typography, layout)
   * loaded from an exported JSON document. Non-theme settings (loop
   * protection, session restore, format-on-save, ...) are intentionally
   * left untouched so preset sharing doesn't override safety preferences.
   */
  applyThemePreset: (preset: {
    theme: 'dark' | 'light';
    editorTheme: string;
    fontFamily: string;
    fontSize: number;
    layoutPreset: LayoutPreset;
  }) => void;
  setLanguage: (language: AppLanguage) => void;
  /**
   * RL-019 Slice 1 fold B — set the per-app default JS/TS runtime
   * mode for newly created tabs. Existing tabs keep their own
   * runtime mode; only `createDefaultTab` reads this preference.
   * Rejects (no-op) for modes that are not yet implemented.
   */
  setDefaultRuntimeMode: (mode: RuntimeMode) => void;
  /**
   * RL-043 Slice C fold D — set the default language for new notebook
   * code cells. Rejects (no-op) anything outside the runnable pair.
   */
  setNotebookDefaultCellLanguage: (
    language: 'javascript' | 'typescript'
  ) => void;
  /**
   * RL-020 Slice 2 — set the default workflow mode for a language.
   * No-op when the language does not support the requested mode.
   * `null` clears the user override and falls back to the shared
   * `defaultWorkflowMode(language)` helper.
   */
  setWorkflowModeDefault: (language: string, mode: WorkflowMode | null) => void;
  /**
   * RL-020 Slice 5 — set the per-language default for bare-expression
   * auto-log mode. No-op for any language outside the JS / TS pair.
   * Emits `runtime.auto_log_enabled` telemetry with closed-enum
   * payload `{ language, enabled }`.
   */
  setScratchpadAutoLogDefault: (language: string, enabled: boolean) => void;
  /**
   * RL-108 — flip inline lint for one language. No-op for languages outside
   * the supported set ({@link SETTINGS_INLINE_LINT_LANGUAGE_SET}). Pure state
   * write; the diagnostic-adoption signal rides
   * `editor.lint_diagnostic_emitted`, not the toggle.
   */
  setInlineLintEnabled: (language: string, enabled: boolean) => void;
  /**
   * RL-020 Slice 6 fold D — flip the master visibility toggle for
   * the bottom-panel `stdin` tab.
   */
  toggleShowStdinPanel: () => void;
  /**
   * RL-112 — set the master visibility toggle for the persistent bottom
   * status bar. Emits `editor.status_bar_toggled` ({ enabled }) telemetry
   * on real change only.
   */
  setShowStatusBar: (enabled: boolean) => void;
  /** RL-093 Slice 3 — switch the variable inspector surface. */
  setVariableInspectorSurface: (surface: 'floating' | 'bottom') => void;
  /**
   * RL-020 Slice 7 — set the per-language timeout preset. Rejects
   * (no-op) for languages outside the supported set
   * (`javascript`, `typescript`, `python`, `go`) and for unknown
   * preset tokens. Fires `runtime.timeout_preset_changed` telemetry
   * (fold A) with closed-enum `{ language, preset }` payload.
   */
  setRuntimeTimeoutPreset: (language: string, preset: RuntimeTimeoutPreset) => void;
  /**
   * RL-020 Slice 7 fold E — flip the countdown-in-pill toggle.
   */
  toggleShowTimeoutCountdown: () => void;
  /** RL-042 Slice 6 — set the Ruby runtime dispatcher preference. */
  setRubyRuntimePreference: (preference: 'auto' | 'system' | 'wasm') => void;
  /**
   * RL-020 Slice 2 fold F — mark the workflow-mode onboarding toast
   * acknowledged. Idempotent. Called when the user explicitly
   * dismisses or just sees the toast.
   */
  acknowledgeFirstWorkflowModeSwitch: () => void;
  setLastSeenVersion: (version: string | null) => void;
  setHasCompletedTour: (value: boolean) => void;
  setSuppressTourAutoStart: (value: boolean) => void;
  setShortcutOverride: (id: string, combos: readonly ShortcutCombo[]) => void;
  clearShortcutOverride: (id: string) => void;
  resetShortcutOverrides: () => void;
  /**
   * RL-097 Slice 1 — Add a header name to the sensitive-headers
   * allowlist. Lowercases + trims before insert; dedupes against
   * the BASELINE list and the existing user list (no-op when
   * already present).
   */
  addSensitiveHttpHeader: (name: string) => void;
  /**
   * RL-097 Slice 1 — Remove a USER-added header name from the
   * allowlist. The baseline list is immutable from this seam;
   * attempts to remove a baseline name no-op silently.
   */
  removeSensitiveHttpHeader: (name: string) => void;
  /**
   * RL-097 Slice 2 — Update the SQL row display cap. Setter accepts
   * any of the four canonical values; unknown values clamp to the
   * default 1000.
   */
  setSqlWorkspaceRowDisplayLimit: (value: 100 | 500 | 1000 | 5000) => void;
  /**
   * RL-097 Slice 2 — Update the SQL query default timeout in
   * milliseconds. Setter clamps to `MAX_QUERY_TIMEOUT_MS` (5 min)
   * and floors at 1 s; non-finite values reset to the 30 s default.
   */
  setSqlWorkspaceQueryTimeoutMs: (value: number) => void;
  /**
   * RL-097 Slice 3 (SQL OPFS) — toggle SQL workspace table persistence.
   * Coerces non-boolean inputs to `false`. The change applies to the
   * next DuckDB instantiate (reload or "Reconnect now"); the live engine
   * is not migrated mid-session.
   */
  setSqlWorkspacePersistTables: (value: boolean) => void;
  /** IT2-C1 — toggle the local Run Ledger (see `runLedgerEnabled`). */
  setRunLedgerEnabled: (value: boolean) => void;
  /**
   * Apply a named keymap preset. Replaces `shortcutOverrides` with the
   * preset's bundle and stores the preset id. Unknown ids are ignored so
   * a malformed persisted preset can't leave the store in a bad shape.
   */
  applyKeymapPreset: (presetId: string) => void;
  /**
   * Apply a named theme pack. Replaces appearance/typography/layout fields
   * with the pack's bundle and stores the pack id. Unknown ids are ignored.
   * Does not touch safety/workflow prefs (loopProtection, restoreSessionMode,
   * formatOnSave) — same rationale as `applyThemePreset`.
   */
  applyThemePack: (packId: string) => void;
}

// --- Runner Types ---

export interface ExecutionContext {
  /**
   * Source language for runtime-mode runners that are not keyed by
   * the original language in their own `LanguageRunner` metadata
   * (for example JS / TS tabs routed through desktop Node).
   */
  language?: string;
  /**
   * Absolute source path for desktop-native runners that need a
   * project-aware cwd. Undefined for unsaved Scratchpad tabs.
   */
  filePath?: string;
  timeout?: number;
  env?: Record<string, string>;
  /**
   * Optional streaming hook for manual execution surfaces. Runners still
   * return the full stdout/stderr arrays at completion; this hook lets
   * the result panel show progress while a debug session is paused.
   */
  onConsole?: (output: ConsoleOutput) => void;
  /**
   * Explicit debugger intent from the UI. Normal Run must ignore
   * breakpoints; only Debug should attach the worker pause protocol.
   */
  debug?: boolean;
  /**
   * RL-027 Slice 1 — tab id of the source being executed. The
   * debugger runner reads breakpoints + watches from the debugger
   * store keyed by this id, so a run on a different tab does not
   * trigger pauses set on another tab.
   */
  tabId?: string;
  /**
   * RL-020 Slice 5 — JS / TS auto-log mode. When `true` the JS / TS
   * runner runs a second source transform that replaces every
   * top-level bare expression statement with an `__mc(line, value)`
   * capture (after the magic-comment transform) so values surface
   * inline without the user typing a `//=>` and side effects run
   * once. Only the
   * auto-run path passes this flag; manual Run + Debug never
   * auto-log.
   */
  autoLog?: boolean;
  /**
   * RL-020 Slice 6 — pre-set stdin buffer the worker consumes for
   * `prompt()` / `readline()` (JS / TS) or `input()` (Python).
   * Newline-delimited; each call consumes one line. Empty /
   * undefined ⇒ native worker behavior. Layered onto the existing
   * `runner.execute` contract; runners that do not consume stdin
   * ignore the field harmlessly.
   */
  stdin?: string;
  /**
   * RL-020 Slice 7 — the resolved preset that produced the active
   * `timeout`. Used by `runnerTimeoutResult` to populate the
   * `RunStatusPill` tooltip with the human-readable preset name
   * ("Run hit the quick limit (5s)"). When `'override'` the run is
   * using an explicit caller-supplied timeout (one-shot extended,
   * magic-comment `// @timeout`, etc.) instead of a Settings
   * preset, and the tooltip falls back to the duration without
   * naming a preset.
   */
  timeoutPreset?: RuntimeTimeoutPreset | 'override';
  /**
   * RL-020 Slice 9 — when `true`, the runner asks its worker to
   * capture the post-execute scope and emit a `ScopeSnapshot` on
   * the resulting `ExecutionResult`. Runners that do not implement
   * scope capture ignore the field harmlessly. The runtime layers
   * (auto-run + manual run) set this to `true` whenever the active
   * tab's `variableInspectorEnabled` flag is on OR the language is
   * one of the inspector's supported set, so the toggle can light
   * up after the first clean run even without the user opting in
   * first.
   */
  captureScope?: boolean;
  /**
   * RL-020 Slice 9 fold E — recursion depth for the scope walker
   * (1–4). `1` is the base scope and matches the renderer's
   * "1-level expand" UX. The runtime threads the user's Settings
   * preference here; runners clamp to the shared `MAX_SCOPE_DEPTH`.
   */
  scopeDepth?: number;
  /**
   * RL-043 Slice B — when `true`, the runner asks its worker to ALSO
   * post the run's structured return value (e.g. the notebook's
   * `{ stdout, stderr, sessionDelta }` object) as live data on
   * `ExecutionResult.structuredResult`, bypassing the display-only
   * string serializer that truncates at `MAX_RESULT_BYTES`. Only the
   * notebook session manager sets this; normal runs leave it unset so
   * the extra structured clone + larger postMessage payload never
   * burdens the hot path. Runners that don't implement structured
   * capture ignore the field harmlessly.
   */
  captureStructuredResult?: boolean;
  /**
   * T17 — per-notebook Python kernel scope. When set (the notebook session
   * passes the notebook's tabId), the Python worker runs the cell against a
   * persistent namespace dedicated to that scope, so cells in one notebook
   * share state while staying isolated from the editor scratchpad and other
   * notebooks. Unset = the legacy shared module-`globals()` path (editor
   * scratchpad). Only the Python runner consumes it; other runners ignore it.
   */
  scopeId?: string;
}

export interface ExecutionError {
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  stack?: string;
  /**
   * RL-044 Slice 2b-α — structured stack frames parsed by the worker
   * (`parseJsErrorStack` / `parsePythonTraceback`). The renderer reads
   * these to build a `kind: 'error'` payload with clickable frames
   * (Sub-slice F). Absent when the worker can't parse a stack — the
   * legacy text path still renders the message + location.
   */
  frames?: import('../../shared/errorStack').ClickableStackFrame[];
}

export interface EditorDiagnostic {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  source?: string;
}

export interface MagicCommentResult {
  line: number;
  value: string;
  /**
   * RL-020 Slice 3 / Slice 5 — which magic-comment shape produced
   * this entry. `'arrow'` for the original `//=>` / `#=>` ad-hoc
   * peek; `'watch'` for the `// @watch <expr>` / `# @watch <expr>`
   * pinned watch; `'autoLog'` for the JS / TS bare-expression
   * auto-log surface added in Slice 5. Runners populate this from
   * `magicCommentKindsByLine(language, source, options)` before
   * dispatch. Optional so a future runner that emits magic results
   * without a transform pass (e.g. a future REPL adapter) doesn't
   * have to backfill the field.
   */
  kind?: 'arrow' | 'watch' | 'autoLog';
  /**
   * RL-044 Slice 1A — optional structured payload the runner
   * attached after detecting a rich-output directive (`//=> table`)
   * or auto-detecting an array of plain objects. `value` stays the
   * canonical string fallback every renderer surface already reads;
   * `payload` adds the typed companion that the inline pill upgrades
   * to a `Table(N×M)` summary (Slice 1A) and the console panel will
   * render as an interactive widget (Slice 1B).
   */
  payload?: RichOutputPayload;
}

export interface ExecutionResult {
  stdout: ConsoleOutput[];
  stderr: ConsoleOutput[];
  result?: unknown;
  executionTime: number;
  /**
   * True when the user explicitly stopped execution. Cancelled runs
   * are not successes and should not be recorded as normal history
   * entries, but they also are not runtime errors in the user's code.
   */
  cancelled?: boolean;
  error?: ExecutionError;
  magicResults?: MagicCommentResult[];
  /**
   * RL-020 Slice 6 fold G — stdin consumption summary. Populated by
   * runners whose worker pulled at least one line out of the pre-set
   * buffer; the StdinInputPanel reads this to render
   * "Used N of M line(s)". `total` is the number of lines in the
   * buffer the worker received; `count` is how many lines the
   * program actually read. Omitted entirely when the run didn't
   * touch stdin.
   */
  stdinConsumed?: { count: number; total: number };
  /**
   * RL-020 Slice 7 — explicit termination kind. The renderer's
   * `<RunStatusPill>` self-gates on this field rather than
   * reverse-engineering the kind from `error.message`. `'success'`
   * is the default when no `error` and no `cancelled` flag fires;
   * `'timeout'` is set by `runnerTimeoutResult`, `'stopped'` by
   * `runnerStoppedResult`, `'error'` by any other thrown / errored
   * path.
   */
  kind?: 'success' | 'error' | 'timeout' | 'stopped';
  /**
   * RL-020 Slice 7 — when `kind === 'timeout'`, names the preset
   * that fired the limit. `'override'` when the run was driven by
   * an explicit caller timeout (one-shot extended / magic-comment).
   */
  timeoutPreset?: RuntimeTimeoutPreset | 'override';
  /**
   * RL-020 Slice 7 — the actual timeout in ms that armed the run.
   * Surfaces in the `RunStatusPill` tooltip + the timed-out result
   * message.
   */
  timeoutMs?: number;
  /**
   * RL-020 Slice 9 — post-execute variable scope captured by the
   * worker. `null` when the runner does not implement capture OR
   * the run errored / timed out / was cancelled. The result store
   * stores the most recent non-null snapshot so the inspector
   * toggle can light up.
   */
  scopeSnapshot?: ScopeSnapshot | null;
  /**
   * RL-043 Slice B — the run's structured return value, posted by the
   * worker when the caller set `ExecutionContext.captureStructuredResult`.
   * Unlike `result` (a display string the worker serializes + truncates
   * at `MAX_RESULT_BYTES`), this carries the live value through the
   * postMessage structured clone, so the notebook's
   * `{ stdout, stderr, sessionDelta }` round-trips losslessly. `undefined`
   * when not requested, when the run errored, or when the value was not
   * structured-cloneable.
   */
  structuredResult?: unknown;
}

export interface ConsoleOutput {
  type: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  line?: number;
  /**
   * RL-044 Slice 1B — rich payload aligned by index with `args`. The legacy
   * `args` string array still ships as the text fallback for non-JS runners
   * + Settings opt-out + payload-missing edge cases. Renderers must treat
   * this as additive: when absent, fall back to `args`.
   */
  payload?: RichOutputPayload[];
}

/**
 * The runner contract every execution backend implements (JS/TS worker,
 * Pyodide, Go WASM, Rust subprocess, Ruby hybrid, plugin runtimes).
 * `RunnerManager` (`src/renderer/runners/manager.ts`) owns the
 * lifecycle: it lazily constructs one runner per language (or per
 * JS/TS runtime mode), gates execution on `isReady()`, and dedupes
 * concurrent `init()` calls through an in-flight promise map.
 *
 * Contract invariants:
 *
 *  - `init()` is the one-time async boot (toolchain detection, WASM
 *    fetch, worker spawn). It may be called again after a failed boot;
 *    a *throw* marks the runner unavailable and the rejection message
 *    is surfaced to the user (e.g. "Go is not installed").
 *  - `execute()` RESOLVES — it never rejects for user-code failures.
 *    Compile errors, runtime errors, timeouts, and stop() all resolve
 *    with an `ExecutionResult` whose `kind` / `error` describe the
 *    outcome, so callers never need try/catch for user-code paths.
 *  - `stop()` is synchronous, idempotent, and must settle any
 *    in-flight `execute()` with a runner-stopped result (no dangling
 *    promises after termination).
 *  - `isReady()` reports whether `init()` completed; the manager uses
 *    it to decide whether a run must await initialization first.
 */
export interface LanguageRunner {
  /** Stable registry key (usually equal to `language`). */
  id: string;
  /** Human-readable name for status surfaces ("Go", "Python"). */
  name: string;
  /** Language-pack id this runner serves. */
  language: Language;
  /** File extensions associated with the language (".go", ".rs"). */
  extensions: string[];
  init(): Promise<void>;
  execute(code: string, context?: ExecutionContext): Promise<ExecutionResult>;
  stop(): void;
  isReady(): boolean;
}

// IT2-A4 — the stale `WorkerRequest` union that used to live here is
// gone: nothing imported it, its shape had drifted from what the runner
// actually posts (no `stop` message exists — runners `terminate()`), and
// it silently omitted the debugger-control variants. The REAL inbound
// contract lives at the receiving end: `WorkerInboundMessage` in
// `workers/js-worker.ts` (= `ExecuteMessage` + the shared
// `DebuggerControlMessage` from `runtime/debuggerWorkerBridge`), enforced
// there by an exhaustiveness `never` guard.

/**
 * Messages sent from the worker to the main thread.
 *
 * RL-078 — every `execute` request carries an opaque `runId` minted
 * by the parent. The worker echoes it on every reply so the parent
 * can drop messages from a previous (terminated-by-timeout) run.
 *
 * The `runId` echo lives on every variant tied to a specific
 * `execute` round; lifecycle messages (`loading` / `ready`) leave
 * it optional because they may fire before the first run.
 */
export type WorkerResponse =
  | {
      type: 'console';
      runId: string;
      method: ConsoleOutput['type'];
      args: string[];
      line?: number;
      /**
       * RL-044 Slice 1B — additive typed payload aligned by index
       * with `args`. Absent from runners that don't emit rich
       * payloads (Python / Go / Rust today); the renderer text path
       * stays the canonical fallback.
       */
      payload?: RichOutputPayload[];
      /**
       * RL-044 Slice 1B fold F — adoption signal for `console.table()`.
       * The runner promotes this into a `runtime.console_table_called`
       * telemetry event; never read by the panel.
       */
      consoleTableInvoked?: boolean;
      /**
       * RL-044 Slice 2b-α — rich-media helper rejection marker emitted
       * by the JS / Python worker bridges. Runner-side telemetry
       * forwarding (`runtime.rich_media_payload_rejected`) landed in
       * Slice 2b-β-β-α fold A; all three runners (JS / TS / Python)
       * read this field and fire-and-forget the event.
       */
      richMediaRejected?: {
        kind: 'chart' | 'image' | 'html';
        reason: 'invalid-src' | 'size-limit' | 'validation-failed';
      };
    }
  | {
      type: 'result';
      runId: string;
      value?: unknown;
      /**
       * RL-043 Slice B — structured return value forwarded losslessly
       * via the postMessage structured clone when the execute request
       * set `captureStructuredResult`. The runner threads this onto
       * `ExecutionResult.structuredResult`; absent for normal runs.
       */
      structured?: unknown;
    }
  | {
      type: 'error';
      /**
       * Optional because the Python worker's lifecycle (`init`)
       * branch reports a load failure before any `execute` request
       * has supplied a runId. Active-run errors always include it.
       */
      runId?: string;
      error: ExecutionError;
    }
  | { type: 'done'; runId: string; executionTime: number }
  | { type: 'loading'; stage: string }
  | { type: 'ready' }
  | {
      type: 'magic-comment';
      runId: string;
      line: number;
      value: string;
      /**
       * RL-044 Slice 1C fold D — when the source carried a `#=> table`
       * directive, the Python worker computes a forced-table payload
       * alongside the legacy stringified `value`. JS / TS workers
       * currently leave this absent and the renderer recovers a
       * payload client-side via `tryParseJsonForPayload +
       * forceTablePayload`. Renderers must always tolerate absence.
       */
      payload?: RichOutputPayload;
    }
  | {
      // RL-027 Slice 1 — debugger pause from the JS worker. Carries
      // the source line, the locals snapshot, the call stack, and any
      // watch-result placeholders for the UI drawer.
      type: 'paused';
      runId: string;
      line: number;
      reason: 'user-breakpoint' | 'step';
      locals: Record<string, string>;
      callStack: { functionName: string; line: number }[];
      watchResults: Record<string, { value?: string; error?: string; pending?: boolean }>;
      conditionalPending?: boolean;
    }
  | { type: 'resumed'; runId: string }
  | {
      /**
       * RL-020 Slice 6 fold G — stdin consumption summary the worker
       * posts right before `done`. `count` is the number of lines the
       * program actually consumed; `total` is the size of the
       * pre-set buffer the worker received. Omitted entirely when
       * the buffer was empty.
       */
      type: 'stdin-consumed';
      runId: string;
      count: number;
      total: number;
    }
  | {
      /**
       * RL-020 Slice 9 — post-execute scope snapshot. The worker
       * captures `globalThis` (JS) or `globals()` (Python) after the
       * user code resolves, filters internal helpers + boot-time
       * names, and walks each remaining binding via the shared
       * `serializeScopeValue` helper. Posted BEFORE `stdin-consumed`
       * and `done` so the runner can stitch the snapshot onto
       * `ExecutionResult.scopeSnapshot`. `error` is set when capture
       * threw inside the worker — the snapshot is still emitted
       * (with empty `variables`) so the runner's threading stays
       * consistent.
       */
      type: 'scope-snapshot';
      runId: string;
      snapshot: ScopeSnapshot;
      error?: string;
    };

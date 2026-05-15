import type { ShortcutCombo, ShortcutOverrideMap } from '../data/keyboardShortcuts';
import type { RuntimeMode } from '../../shared/runtimeModes';
import type { WorkflowMode } from '../../shared/workflowMode';
import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
import type { ScopeSnapshot } from '../../shared/scopeSnapshot';

export type { RuntimeTimeoutPreset };
export type { ScopeSnapshot };

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
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  /**
   * RL-070 — flip the per-tab lifecycle marker. Called by the runner
   * when execution starts (`running`), resolves cleanly (`success`),
   * or fails (`error`). `parseError` accepts an optional one-line
   * explanation that the tab bar surfaces via title tooltip on
   * error states.
   */
  setTabExecutionState: (
    id: string,
    state: TabExecutionState,
    parseError?: string | null
  ) => void;
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
  /** Execution time in ms — shown as a badge when set (only on the last entry) */
  executionTime?: number;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  /** Which entry types are currently visible */
  activeFilters: Set<ConsoleEntryType>;
  showTimestamps: boolean;
  addEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => void;
  clear: () => void;
  toggleFilter: (type: ConsoleEntryType) => void;
  toggleTimestamps: () => void;
}

export type LayoutPreset = 'horizontal' | 'vertical' | 'editor-only';

export interface SettingsState {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontSize: number;
  fontFamily: string;
  fontLigatures: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
  layoutPreset: LayoutPreset;
  loopProtection: boolean;
  maxLoopIterations: number;
  hideUndefined: boolean;
  restoreSession: boolean;
  formatOnSave: boolean;
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
   * When on, the dark/light shell polarity follows the current editor
   * theme's polarity (so picking VS Light auto-flips the console and result
   * panels to light). When off, the explicit `theme` setting is honored.
   */
  syncShellWithEditorTheme: boolean;
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
   * RL-027 Slice 1 — debugger master switch. Default `true` (the
   * feature is discoverable on first install). Off → the gutter no
   * longer toggles breakpoints, the drawer stays hidden, and the JS
   * runner skips instrumentation entirely so non-debug runs pay no
   * overhead. Per ADR §Rollback this is the kill switch for the
   * whole feature.
   */
  debuggerEnabled: boolean;
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
   * RL-020 Slice 6 fold D — master visibility toggle for the
   * bottom-panel `stdin` tab. Default `true` (the tab is offered
   * for JS / TS / Python tabs). When `false`, the BottomPanel
   * strip skips the entry entirely, so users who never use stdin
   * keep the leaner three-tab strip.
   */
  showStdinPanel: boolean;
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
   * RL-020 Slice 2 fold F — one-shot acknowledgement flag for the
   * "Scratchpad auto-runs as you type; Run waits for Cmd+R"
   * onboarding toast. Set to `true` the first time the user switches
   * a tab away from Scratchpad; the toast never re-fires after that.
   * Resettable from Settings → Account → Privacy (next slice) so
   * users can re-trigger the tour on a fresh install.
   */
  firstWorkflowModeSwitchAcknowledged: boolean;
  language: AppLanguage;
  lastSeenVersion: string | null;
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
   * same rationale that keeps loopProtection/restoreSession out of presets.
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
  setTheme: (theme: 'dark' | 'light') => void;
  setEditorTheme: (theme: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleFontLigatures: () => void;
  toggleLineNumbers: () => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  toggleLoopProtection: () => void;
  setMaxLoopIterations: (max: number) => void;
  toggleHideUndefined: () => void;
  toggleRestoreSession: () => void;
  toggleFormatOnSave: () => void;
  toggleVimMode: () => void;
  /** RL-079 — flip the native-execution acknowledgement flag. */
  setNativeExecutionAcknowledged: (value: boolean) => void;
  toggleSyncShellWithEditorTheme: () => void;
  toggleExecutionHistorySnapshot: () => void;
  setTelemetryConsent: (next: 'granted' | 'declined') => void;
  /** RL-069 Slice 3 — flip clipboard-on-focus consent (granted/declined). */
  setUtilitiesClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /** RL-027 Slice 1 — toggle the debugger master switch. */
  toggleDebuggerEnabled: () => void;
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
    fontLigatures: boolean;
    layoutPreset: LayoutPreset;
    syncShellWithEditorTheme?: boolean;
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
   * RL-020 Slice 6 fold D — flip the master visibility toggle for
   * the bottom-panel `stdin` tab.
   */
  toggleShowStdinPanel: () => void;
  /**
   * RL-020 Slice 7 — set the per-language timeout preset. Rejects
   * (no-op) for languages outside the supported set
   * (`javascript`, `typescript`, `python`, `go`) and for unknown
   * preset tokens. Fires `runtime.timeout_preset_changed` telemetry
   * (fold A) with closed-enum `{ language, preset }` payload.
   */
  setRuntimeTimeoutPreset: (
    language: string,
    preset: RuntimeTimeoutPreset
  ) => void;
  /**
   * RL-020 Slice 7 fold E — flip the countdown-in-pill toggle.
   */
  toggleShowTimeoutCountdown: () => void;
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
   * Apply a named keymap preset. Replaces `shortcutOverrides` with the
   * preset's bundle and stores the preset id. Unknown ids are ignored so
   * a malformed persisted preset can't leave the store in a bad shape.
   */
  applyKeymapPreset: (presetId: string) => void;
  /**
   * Apply a named theme pack. Replaces appearance/typography/layout fields
   * with the pack's bundle and stores the pack id. Unknown ids are ignored.
   * Does not touch safety/workflow prefs (loopProtection, restoreSession,
   * formatOnSave) — same rationale as `applyThemePreset`.
   */
  applyThemePack: (packId: string) => void;
}

// --- Runner Types ---

export interface ExecutionContext {
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
}

export interface ExecutionError {
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  stack?: string;
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
}

export interface ConsoleOutput {
  type: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  line?: number;
}

export interface LanguageRunner {
  id: string;
  name: string;
  language: Language;
  extensions: string[];
  init(): Promise<void>;
  execute(code: string, context?: ExecutionContext): Promise<ExecutionResult>;
  stop(): void;
  isReady(): boolean;
}

/**
 * Messages sent from the main thread to the worker.
 *
 * RL-078 — every `execute` request carries an opaque `runId` minted
 * by the parent. The worker echoes it on every reply so the parent
 * can drop messages from a previous (terminated-by-timeout) run.
 */
export type WorkerRequest =
  | {
      type: 'execute';
      runId: string;
      code: string;
      timeout: number;
      resultTruncationMarker: string;
      userEnv?: Record<string, string>;
    }
  | { type: 'stop' };

/**
 * Messages sent from the worker to the main thread.
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
    }
  | { type: 'result'; runId: string; value?: unknown }
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
  | { type: 'magic-comment'; runId: string; line: number; value: string }
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

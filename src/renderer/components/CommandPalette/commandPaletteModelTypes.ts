/**
 * Stable command model types plus the internal registry builder contract.
 *
 * `CommandCategory` and `CommandEntry` remain re-exported from the historical
 * commandPaletteModel.ts facade. Registry-only types stay on this leaf.
 */

import type { TFunction } from 'i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import type { Template } from '../../data/templates';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import type { Snippet } from '../../stores/snippetsStore';
import type { FileTab } from '../../types/editor';
import type { Language } from '../../types/language';
import type { LayoutPreset } from '../../types/settings';
import type { RuntimeMode } from '../../../shared/runtimeModes';

export type CommandCategory = 'template' | 'snippet' | 'action';

export interface CommandEntry {
  id: string;
  category: CommandCategory;
  label: string;
  description: string;
  language?: Language;
  keywords: string[];
  action: () => void;
}

export interface BuildCommandPaletteModelArgs {
  templates: readonly Template[];
  snippets: Snippet[];
  /**
   * implementation — the most recent executions surfaced as palette
   * entries so the user can jump back to "what I just ran" without
   * navigating the Settings panel. Optional for legacy callers.
   */
  executionHistory?: readonly ExecutionHistoryEntry[];
  /** Canonical baseline Run entry, independent from paid replay/history. */
  onRunActiveTab?: () => void;
  /** Open a folder as the active project. */
  onOpenProject?: () => void | Promise<void>;
  /** Open the project test-suite detector. */
  onOpenProjectTests?: () => void;
  /** Open Settings directly on the license-token input. */
  onApplyLicense?: () => void;
  /**
   * Called when the user activates a Recent-runs entry. The caller
   * decides what focus means — today it's a no-op or a tab-focus;
   * implementation of internal may wire it to a real replay action.
   */
  onFocusLanguageTab?: (language: Language) => void;
  /**
   * implementation — fires when the user runs the "Re-run last
   * execution" palette action. Optional so legacy callers without an
   * execution surface keep working; when omitted the action is hidden.
   */
  onRerunLast?: () => void;
  /**
   * implementation note — fires when the user picks the "New
   * project from template…" palette action. Optional so callers
   * without a Welcome surface (e.g. test scaffolds) keep working;
   * when omitted the action is hidden.
   */
  onNewProjectFromTemplate?: () => void;
  /**
   * implementation — fires when the user activates "Restore last session".
   * Optional; surfaced only when the caller wires it AND a persisted or
   * ask-mode-pinned snapshot with ≥1 tab exists ({@link savedSessionTabCount}),
   * so the command never offers to restore nothing. Lets a `never`/`ask` user
   * trigger restore on demand after dismissing the boot prompt.
   */
  onRestoreSession?: () => void;
  /**
   * implementation — fires when the user activates "Toggle inline lint".
   * Optional; surfaced only when the active tab is a lintable JS/TS language
   * (the caller decides). Flips the per-language inline-lint setting.
   */
  onToggleInlineLint?: () => void;
  /**
   * implementation — custom-lint issue count for the active JS/TS tab. When > 0
   * the "Toggle inline lint" command description previews it (e.g. "… · 2
   * issues"). Defaults to 0 (plain description). Computed by the caller via
   * `countCustomLintIssues` so the model stays free of editor coupling.
   */
  inlineLintActiveIssueCount?: number;
  /**
   * implementation — fires the "Paste as plain text" action, a discoverable
   * surface for the editor's Cmd+Shift+V bypass. The caller drives a
   * detection-bypassing paste on the active editor via `requestPlainPaste`.
   * Optional; surfaced only when wired (i.e. an editor is active).
   */
  onPastePlainText?: () => void;
  /**
   * implementation — fires the "Toggle status bar" action, flipping the
   * `showStatusBar` setting. Optional; when omitted the command is hidden.
   */
  onToggleStatusBar?: () => void;
  /**
   * implementation — fires the "Benchmark this tab" action, which re-runs the active
   * tab's code N times and reports timing stats to the console. Optional;
   * the caller wires it only when the active tab is a worker-runner
   * language AND the effective tier holds the `BENCHMARK` entitlement, so
   * the command stays hidden for Free users and non-benchmarkable tabs.
   */
  onBenchmarkActiveTab?: () => void;
  /**
   * implementation — fires the "Explain last error" action, which runs the offline
   * error explainer against the most recent run error and reports the
   * explanation to the console. Optional; the caller wires it only when
   * there is an error to explain AND the effective tier holds the
   * `LOCAL_AI` entitlement, so the command stays hidden otherwise.
   */
  onExplainLastError?: () => void;
  /**
   * internal  — fires "Explain selected code with AI", opening the
   * consent-first ExplainCodeDialog over the current editor selection (or
   * the whole buffer). Optional; wired only when the tier holds `LOCAL_AI`
   * and an editor tab is active, so the command stays hidden otherwise.
   */
  onExplainSelectedCode?: () => void;
  /**
   * implementation — fires the "Install detected packages" action for a Go / Rust /
   * Ruby tab: detects imports/crates/gems in the active buffer and runs
   * the toolchain install (go get / cargo add / bundle add). Optional; the
   * caller wires it only when the active tab is a saved Go/Rust/Ruby file
   * with detectable third-party dependencies.
   */
  onInstallNativeDependencies?: () => void;
  /**
   * implementation — fires the "Focus status bar" action, moving keyboard
   * focus to the bar's first segment via `focusStatusBar()`. Optional;
   * surfaced only when wired AND the bar is currently visible (the caller
   * gates on `showStatusBar`) so the palette never offers to focus a bar
   * that is not on screen.
   */
  onFocusStatusBar?: () => void;
  /**
   * implementation — saved-session tab count, gating the Restore command's
   * visibility. The caller may pass an in-memory pending ask-mode snapshot
   * count here. Defaults to 0 (command hidden) for callers without a session
   * surface.
   */
  savedSessionTabCount?: number;
  /**
   * implementation detail — fires when the user activates a per-entry
   * "Replay {language} run · {status} · {duration}" palette command.
   * Optional; when omitted no replay commands are emitted. Caller is
   * expected to dispatch `replayHistoryEntry(entry, ...)` so the run
   * does not append another history entry.
   */
  onReplayEntry?: (entry: ExecutionHistoryEntry) => void;
  /**
   * implementation — fires when the user activates the
   * "Toggle Vim mode" palette command. Optional; when omitted the
   * command is hidden.
   */
  onToggleVimMode?: () => void;
  /**
   * Current Vim-mode flag, used to flip the palette description text
   * between "Turn on Vim keybindings…" and "Turn off…". Defaults to
   * `false` so callers that wire `onToggleVimMode` without this flag
   * still get a usable command (the description just always reads as
   * the enable variant).
   */
  vimModeEnabled?: boolean;
  /**
   * implementation note — fires when the user activates one of
   * the "Switch runtime to X" palette entries. Optional; when
   * omitted the three entries are hidden. The caller forwards to
   * `editorStore.setTabRuntimeMode` which enforces the
   * implementation guard and emits the
   * `runtime.mode_changed` telemetry.
   */
  onSetRuntimeMode?: (mode: RuntimeMode) => void;
  /**
   * Active tab's current runtime mode; used to highlight the
   * "currently selected" entry. `null` for non-JS/TS tabs, which
   * also suppresses the three runtime-mode entries entirely.
   */
  activeRuntimeMode?: RuntimeMode | null;
  /**
   * implementation note — fires when the user activates the "Pin
   * watch on current line" palette action. The caller in `App.tsx`
   * reads the active editor's cursor + line text, infers an
   * expression via `appendWatchAtLine`, and writes the updated
   * buffer back through `editorStore.updateContent`. Optional;
   * when omitted the action is hidden. `activeWatchLanguage` is
   * the active tab's language used to flip the action's
   * description between "JS / TS" and "Python" wording AND to
   * skip the entry entirely for languages that do not support
   * `@watch` (anything outside JS / TS / Python).
   */
  onAddWatchToCurrentLine?: () => void;
  activeWatchLanguage?: Language | null;
  /**
   * implementation note — fires when the user activates the
   * "Toggle auto-log for this tab" palette action. The caller in
   * `App.tsx` flips the per-tab `autoLogEnabled` field by reading
   * the resolved current state and writing the opposite via
   * `editorStore.setTabAutoLogEnabled`. Optional; when omitted the
   * action is hidden. Only JS / TS Scratchpad tabs surface the
   * action; everything else hides it.
   */
  onToggleAutoLogOnActiveTab?: () => void;
  activeAutoLogResolved?: boolean;
  /**
   * implementation note — focus the Input tab on the bottom
   * panel from the command palette. The caller in `CommandPalette.tsx`
   * calls `openBottomPanel('stdin')`; the action is hidden when the
   * active tab's language is not JS / TS / Python or when the
   * master `showStdinPanel` Settings toggle is OFF.
   */
  onFocusStdinPanel?: () => void;
  /**
   * implementation note — true when the language + Settings flag
   * combination permits the stdin panel; the model uses this to
   * gate the palette entry's visibility.
   */
  stdinPanelAvailable?: boolean;
  /**
   * implementation note — set the active language's timeout
   * preset. Hidden when the active language isn't in the supported
   * set (JS / TS / Python / Go) or when the caller didn't wire it.
   */
  onSetActiveLanguageTimeoutPreset?: (preset: 'quick' | 'normal' | 'long' | 'extended') => void;
  /**
   * implementation note — the language the palette will adjust.
   * Used as a closed-enum gate so the action is only visible on
   * supported languages. implementation added Ruby to the enrolled
   * set when the @ruby/wasm-wasi web runner shipped.
   */
  activeTimeoutLanguage?: 'javascript' | 'typescript' | 'python' | 'go' | 'ruby' | null;
  /**
   * implementation note — the active preset for the language
   * above. Drives the dynamic description on each palette entry so
   * the user sees which preset is currently active.
   */
  activeTimeoutPreset?: 'quick' | 'normal' | 'long' | 'extended' | null;
  /**
   * implementation note — fires the "Run with extended timeout"
   * one-shot action. Caller is responsible for wiring the override
   * into the next run via `setTabNextRunTimeoutOverride` and
   * dispatching the run. Hidden when omitted or when the active
   * language is not timeout-preset supported.
   */
  onRunWithExtendedTimeout?: () => void;
  /**
   * implementation note — fires the "Toggle compare with last
   * stable run" palette action. Caller wires it via
   * `setTabCompareEnabled` on the active tab. Optional; hidden
   * when the active tab is missing or `executionMode === 'view'`.
   */
  onToggleCompareWithSnapshot?: () => void;
  /**
   * implementation note — `true` when the active tab currently
   * has the Compare toggle on. The palette description flips
   * between "Show diff" and "Hide diff" based on this flag, the
   * same way the auto-log entry flips between enabled / disabled.
   */
  activeCompareEnabled?: boolean;
  /**
   * implementation note — `true` when the result store carries a
   * comparator snapshot for the active language. Drives the
   * palette gate so the action stays hidden when there's nothing
   * to diff against — same UX contract as the toggle button.
   */
  compareSnapshotAvailable?: boolean;
  /**
   * implementation note — fires the "Toggle variable inspector"
   * palette action. Caller wires it via
   * `setTabVariableInspectorEnabled` on the active tab. Optional;
   * hidden when omitted or when the active tab is missing.
   */
  onToggleVariableInspector?: () => void;
  /**
   * implementation note — `true` when the active tab currently
   * has the Variables toggle on. The palette description flips
   * between "Show / Hide" based on this flag.
   */
  activeVariableInspectorEnabled?: boolean;
  /**
   * implementation note — `true` when the result store carries a
   * scope snapshot for the active language. Drives the palette
   * gate so the action stays hidden when there's nothing to
   * inspect.
   */
  variableInspectorScopeAvailable?: boolean;
  // implementation reviewer pass — `onToggleConsoleRichRendering` and
  // `consoleRichRenderingEnabled` removed. The
  // `consoleRichRenderingEnabled` Settings toggle was killed; rich
  // rendering is baseline. The palette no longer surfaces a way to
  // resurrect the legacy text-only console output.
  /**
   * implementation note — id of the active editor tab. Used to
   * surface a parallel "Recent runs (this tab)" group ranked above
   * the global recent-runs entries when at least one history entry
   * has a matching `tabId`. Optional; when omitted or null, the
   * per-tab group is suppressed and only the legacy global entries
   * surface (existing behavior preserved).
   */
  activeTabId?: string | null;
  updateStatus: UpdateStatus;
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void;
  createDefaultTab: (language: Language) => FileTab;
  setLayoutPreset: (preset: LayoutPreset) => void;
  /** internal — presenter/focus mode toggle; hidden when omitted. */
  onTogglePresenterMode?: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenSnippets: () => void;
  onOpenProjectSearch?: () => void;
  // implementation — invoked when the user picks the
  // `action-project-replace` palette entry.
  onOpenProjectReplace?: () => void;
  // implementation — invoked when the user picks the
  // `action-open-http-workspace` palette entry. MOV.02 (FASE 3):
  // opens or focuses the full-screen HTTP workspace tab (the dock
  // panel was removed); the caller wires this to
  // `openHttpWorkspaceTab()`.
  onOpenHttpWorkspace?: () => void;
  // implementation — invoked when the user picks the
  // `action-open-sql-workspace` palette entry. Mirror of
  // `onOpenHttpWorkspace`.
  onOpenSqlWorkspace?: () => void;
  onOpenGoToSymbol?: () => void;
  onOpenDeveloperUtility?: (id: DeveloperUtilityId) => void;
  onOpenKeyboardShortcuts?: () => void;
  checkForUpdates: () => Promise<void>;
  restartToApply: () => Promise<boolean>;
  openFileFromDisk?: () => Promise<void>;
  saveActiveTabAs?: () => Promise<void>;
  duplicateActiveTab?: () => void;
  /**
   * implementation note — fires when the user activates the "Export
   * latest run as capsule" palette command. The caller in `App.tsx`
   * mirrors the Settings → Account → Run Capsules export flow:
   * sanitises + serialises the latest captured `RunCapsuleV1`,
   * writes to clipboard, fires `capsule.exported.trigger=palette-export`
   * telemetry, falls back to an inline textarea when clipboard fails.
   * Optional; when omitted or no latest capsule exists, the action
   * hides entirely so the palette never advertises a no-op.
   */
  onExportLatestCapsule?: () => void;
  /**
   * `true` iff the execution-history store has at least one entry
   * whose `lastCapsule` field is defined. Drives the visibility +
   * the description copy of the palette entry above.
   */
  latestCapsuleAvailable?: boolean;
  /**
   * implementation — fires when the user activates the "Import
   * capsule from JSON" palette command. App.tsx opens the
   * `capsule-import` AppOverlay; the overlay owns the rest of the
   * flow. Optional; when omitted the action hides.
   */
  onOpenCapsuleImport?: () => void;
  /**
   * implementation — fires when the user activates the "Browse run
   * capsules" palette command. App.tsx claims the `palette` surface
   * and opens the `capsule-list` AppOverlay; the overlay owns the
   * Pro-gating + per-row actions. Optional; when omitted the action
   * hides. Always available when wired (no history precondition) so
   * a Free user can discover the surface and hit the upsell.
   */
  onBrowseCapsules?: () => void;
  /**
   * implementation — fires when the user activates "Export project as
   * zip". Direct action (App.tsx calls `useProjectBundle().
   * exportProjectBundle`); no overlay. Optional; hides when omitted.
   */
  onExportProjectBundle?: () => void;
  /**
   * implementation — fires when the user activates "Import project from
   * zip". App.tsx opens the `project-bundle-import` AppOverlay.
   * Optional; hides when omitted.
   */
  onImportProjectBundle?: () => void;
  /**
   * implementation — fires when the user activates the "Import
   * data…" palette command. App.tsx opens the `import-preview`
   * AppOverlay; the overlay owns the rest of the flow. Optional;
   * when omitted the action hides.
   */
  onOpenImportOverlay?: () => void;
  /**
   * Opens the Recipes overlay (`Mod+Alt+L`) through App's single-slot
   * overlay coordinator. Optional; when omitted the action hides.
   */
  onOpenRecipes?: () => void;
  /**
   * implementation Slice A implementation note — creates a fresh notebook tab via
   * `Mod+Alt+N`. Optional; when omitted the palette entry hides.
   */
  onNewNotebook?: () => void;
  /**
   * implementation Slice E implementation note — export the ACTIVE notebook to a `.linguanb`
   * document. Optional; when omitted the palette entry hides. The
   * callback no-ops with a status notice when the active tab is not a
   * notebook, so the entry can stay always-listed.
   */
  onExportActiveNotebookLinguanb?: () => void;
  /**
   * implementation note — opens Settings on the Languages tab and
   * scrolls to the Language Support Scorecard. Optional; when
   * omitted the palette entry is hidden.
   */
  onShowLanguageSupport?: () => void;
  /**
   * implementation note — renders `LANGUAGE_SUPPORT_PROFILES` as a
   * Markdown table and copies it to the clipboard. Optional; when
   * omitted the palette entry is hidden.
   */
  onCopyLanguageScorecardMarkdown?: () => void;
  /** internal — copies the local duration-only boot timing snapshot as JSON. */
  onCopyBootTimings?: () => void;
  /**
   * implementation Phase A1 implementation note — encodes the active tab as a share-link
   * URL fragment and copies it to the clipboard (via the
   * confirmation modal gate from implementation note, unless the user disabled
   * it). Optional; when omitted the palette entry is hidden so the
   * model stays honest about what surfaces are wired.
   */
  onCopyShareLink?: () => void;
  /**
   * implementation note — three palette entries that re-arm a
   * single onboarding stage each (welcome seed / first-run tip /
   * first-snippet tip). Each callback flips ONLY its stage's flag
   * back to `false`. The welcome callback additionally resets the
   * seed-version tracker so the next boot re-seeds even when
   * `SEEDED_SCRATCHPAD_VERSION` matches the persisted value. Useful
   * for support, demos, and power-user QA.
   */
  onReplayOnboardingWelcome?: () => void;
  onReplayOnboardingFirstRun?: () => void;
  onReplayOnboardingFirstSnippet?: () => void;
  /**
   * implementation note — opens Settings on the Privacy tab. Espejo
   * del patrón `onShowLanguageSupport` from internal (closes the
   * palette first, then runs the callback so both overlays don't
   * compete for the same App state slot).
   */
  onShowPrivacyDashboard?: () => void;
  /**
   * implementation — opens the bottom-panel Dependencies tab for the
   * active file. Optional; when omitted (or when the active tab has
   * no detected dependencies) the palette entry is hidden so the
   * model stays honest about what surfaces are wired right now.
   * Espejo del patrón `onShowLanguageSupport`: close palette first,
   * then run the callback.
   */
  onShowDependencies?: () => void;
  /**
   * implementation Sub-slice G implementation note — flips the
   * `outputSourceMappingEnabled` master toggle. Same close-palette-
   * first ordering as the other action callbacks. When omitted the
   * palette entry is hidden so model stays honest about wired
   * surfaces.
   */
  onToggleOutputSourceMapping?: () => void;
  /**
   * Translation function. Optional so legacy callers keep working without
   * wiring i18next; when omitted, built-in action labels and descriptions
   * fall back to their English keys.
   */
  t?: TFunction;
}

type CommandPaletteTranslate = (key: string, options?: Record<string, unknown>) => string;

interface CommandPaletteRegistryContext {
  args: BuildCommandPaletteModelArgs;
  translate: CommandPaletteTranslate;
}

export type CommandPaletteRegistry = (context: CommandPaletteRegistryContext) => CommandEntry[];

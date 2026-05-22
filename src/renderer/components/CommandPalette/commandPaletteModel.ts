import type { TFunction } from 'i18next';
import {
  DEVELOPER_UTILITIES,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import {
  resolveTemplateFileStem,
  resolveTemplateDescription,
  resolveTemplateLabel,
  type Template,
} from '../../data/templates';
import type { Snippet } from '../../stores/snippetsStore';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import type { FileTab, Language, LayoutPreset } from '../../types';
import { formatExecTime } from '../../hooks/runnerOutput';
import { extensionForLanguage, languageLabel } from '../../utils/languageMeta';

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

interface BuildCommandPaletteModelArgs {
  templates: readonly Template[];
  snippets: Snippet[];
  /**
   * RL-028 third slice — the most recent executions surfaced as palette
   * entries so the user can jump back to "what I just ran" without
   * navigating the Settings panel. Optional for legacy callers.
   */
  executionHistory?: readonly ExecutionHistoryEntry[];
  /**
   * Called when the user activates a Recent-runs entry. The caller
   * decides what focus means — today it's a no-op or a tab-focus;
   * Slice D of RL-028 may wire it to a real replay action.
   */
  onFocusLanguageTab?: (language: Language) => void;
  /**
   * RL-028 fourth slice — fires when the user runs the "Re-run last
   * execution" palette action. Optional so legacy callers without an
   * execution surface keep working; when omitted the action is hidden.
   */
  onRerunLast?: () => void;
  /**
   * RL-028 sixth slice trailer — fires when the user activates a per-entry
   * "Replay {language} run · {status} · {duration}" palette command.
   * Optional; when omitted no replay commands are emitted. Caller is
   * expected to dispatch `replayHistoryEntry(entry, ...)` so the run
   * does not append another history entry.
   */
  onReplayEntry?: (entry: ExecutionHistoryEntry) => void;
  /**
   * RL-037 Vim slice — fires when the user activates the
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
   * RL-019 Slice 1 fold E — fires when the user activates one of
   * the "Switch runtime to X" palette entries. Optional; when
   * omitted the three entries are hidden. The caller forwards to
   * `editorStore.setTabRuntimeMode` which enforces the
   * implementation-status guard and emits the
   * `runtime.mode_changed` telemetry.
   */
  onSetRuntimeMode?: (mode: 'worker' | 'node' | 'browser-preview') => void;
  /**
   * Active tab's current runtime mode; used to highlight the
   * "currently selected" entry. `null` for non-JS/TS tabs, which
   * also suppresses the three runtime-mode entries entirely.
   */
  activeRuntimeMode?: 'worker' | 'node' | 'browser-preview' | null;
  /**
   * RL-020 Slice 3 fold E — fires when the user activates the "Pin
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
   * RL-020 Slice 5 fold D — fires when the user activates the
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
   * RL-020 Slice 6 fold E — focus the Input tab on the bottom
   * panel from the command palette. The caller in `CommandPalette.tsx`
   * calls `openBottomPanel('stdin')`; the action is hidden when the
   * active tab's language is not JS / TS / Python or when the
   * master `showStdinPanel` Settings toggle is OFF.
   */
  onFocusStdinPanel?: () => void;
  /**
   * RL-020 Slice 6 fold E — true when the language + Settings flag
   * combination permits the stdin panel; the model uses this to
   * gate the palette entry's visibility.
   */
  stdinPanelAvailable?: boolean;
  /**
   * RL-020 Slice 7 fold C — set the active language's timeout
   * preset. Hidden when the active language isn't in the supported
   * set (JS / TS / Python / Go) or when the caller didn't wire it.
   */
  onSetActiveLanguageTimeoutPreset?: (
    preset: 'quick' | 'normal' | 'long' | 'extended'
  ) => void;
  /**
   * RL-020 Slice 7 fold C — the language the palette will adjust.
   * Used as a closed-enum gate so the action is only visible on
   * supported languages. RL-042 Slice 5 added Ruby to the enrolled
   * set when the @ruby/wasm-wasi web runner shipped.
   */
  activeTimeoutLanguage?:
    | 'javascript'
    | 'typescript'
    | 'python'
    | 'go'
    | 'ruby'
    | null;
  /**
   * RL-020 Slice 7 fold C — the active preset for the language
   * above. Drives the dynamic description on each palette entry so
   * the user sees which preset is currently active.
   */
  activeTimeoutPreset?: 'quick' | 'normal' | 'long' | 'extended' | null;
  /**
   * RL-020 Slice 7 fold D — fires the "Run with extended timeout"
   * one-shot action. Caller is responsible for wiring the override
   * into the next run via `setTabNextRunTimeoutOverride` and
   * dispatching the run. Hidden when omitted or when the active
   * language is not timeout-preset supported.
   */
  onRunWithExtendedTimeout?: () => void;
  /**
   * RL-020 Slice 8 fold C — fires the "Toggle compare with last
   * stable run" palette action. Caller wires it via
   * `setTabCompareEnabled` on the active tab. Optional; hidden
   * when the active tab is missing or `executionMode === 'view'`.
   */
  onToggleCompareWithSnapshot?: () => void;
  /**
   * RL-020 Slice 8 fold C — `true` when the active tab currently
   * has the Compare toggle on. The palette description flips
   * between "Show diff" and "Hide diff" based on this flag, the
   * same way the auto-log entry flips between enabled / disabled.
   */
  activeCompareEnabled?: boolean;
  /**
   * RL-020 Slice 8 fold C — `true` when the result store carries a
   * comparator snapshot for the active language. Drives the
   * palette gate so the action stays hidden when there's nothing
   * to diff against — same UX contract as the toggle button.
   */
  compareSnapshotAvailable?: boolean;
  /**
   * RL-020 Slice 9 fold B — fires the "Toggle variable inspector"
   * palette action. Caller wires it via
   * `setTabVariableInspectorEnabled` on the active tab. Optional;
   * hidden when omitted or when the active tab is missing.
   */
  onToggleVariableInspector?: () => void;
  /**
   * RL-020 Slice 9 fold B — `true` when the active tab currently
   * has the Variables toggle on. The palette description flips
   * between "Show / Hide" based on this flag.
   */
  activeVariableInspectorEnabled?: boolean;
  /**
   * RL-020 Slice 9 fold B — `true` when the result store carries a
   * scope snapshot for the active language. Drives the palette
   * gate so the action stays hidden when there's nothing to
   * inspect.
   */
  variableInspectorScopeAvailable?: boolean;
  /**
   * RL-044 Slice 1B fold B — fires the "Toggle rich console output"
   * palette action. Optional; when omitted the action is hidden.
   * Always available regardless of language / runner since the
   * console is global.
   */
  onToggleConsoleRichRendering?: () => void;
  /**
   * RL-044 Slice 1B fold B — current value of
   * `Settings.consoleRichRenderingEnabled`. Drives the description
   * text between "Use legacy text-only console output" and "Restore
   * rich console rendering" so the palette honestly previews the
   * next state.
   */
  consoleRichRenderingEnabled?: boolean;
  /**
   * RL-020 Slice 4 fold G — id of the active editor tab. Used to
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
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenSnippets: () => void;
  onOpenProjectSearch?: () => void;
  onOpenGoToSymbol?: () => void;
  onOpenDeveloperUtility?: (id: DeveloperUtilityId) => void;
  onOpenKeyboardShortcuts?: () => void;
  checkForUpdates: () => Promise<void>;
  restartToApply: () => Promise<boolean>;
  openFileFromDisk?: () => Promise<void>;
  saveActiveTabAs?: () => Promise<void>;
  duplicateActiveTab?: () => void;
  /**
   * RL-094 Slice 1 fold B — fires when the user activates the "Export
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
   * RL-095 Slice 1 fold B — opens Settings on the Languages tab and
   * scrolls to the Language Support Scorecard. Optional; when
   * omitted the palette entry is hidden.
   */
  onShowLanguageSupport?: () => void;
  /**
   * RL-095 Slice 1 fold F — renders `LANGUAGE_SUPPORT_PROFILES` as a
   * Markdown table and copies it to the clipboard. Optional; when
   * omitted the palette entry is hidden.
   */
  onCopyLanguageScorecardMarkdown?: () => void;
  /**
   * RL-036 Phase A1 fold C — encodes the active tab as a share-link
   * URL fragment and copies it to the clipboard (via the
   * confirmation modal gate from fold A, unless the user disabled
   * it). Optional; when omitted the palette entry is hidden so the
   * model stays honest about what surfaces are wired.
   */
  onCopyShareLink?: () => void;
  /**
   * RL-101 Slice 1 fold G — three palette entries that re-arm a
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
   * RL-096 Slice 1 fold B — opens Settings on the Privacy tab. Espejo
   * del patrón `onShowLanguageSupport` from RL-095 (closes the
   * palette first, then runs the callback so both overlays don't
   * compete for the same App state slot).
   */
  onShowPrivacyDashboard?: () => void;
  /**
   * RL-025 Slice A — opens the bottom-panel Dependencies tab for the
   * active file. Optional; when omitted (or when the active tab has
   * no detected dependencies) the palette entry is hidden so the
   * model stays honest about what surfaces are wired right now.
   * Espejo del patrón `onShowLanguageSupport`: close palette first,
   * then run the callback.
   */
  onShowDependencies?: () => void;
  /**
   * RL-044 Sub-slice G Fold C — flips the
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

function normalizeKeywords(values: Array<string | undefined>) {
  return values.map((value) => value?.toLowerCase() ?? '');
}

function buildTemplateCommand(
  template: Template,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void,
  t?: TFunction
): CommandEntry {
  const label = resolveTemplateLabel(template, t);
  const description = resolveTemplateDescription(template, t);
  const fileStem = resolveTemplateFileStem(template);

  return {
    id: `tpl-${template.id}`,
    category: 'template',
    label,
    description,
    language: template.language,
    // Keep the English `fileStem` in the keyword index so the command palette
    // stays bilingually searchable even when the active locale is not `en`
    // (see RL-018 Phase 3: discoverability aliases must survive localization).
    keywords: normalizeKeywords([label, fileStem, template.language, description]),
    action: () => {
      const tab = createDefaultTab(template.language);
      createTab({
        ...tab,
        content: template.code,
        name: `${fileStem}.${extensionForLanguage(template.language)}`,
      });
      onClose();
    },
  };
}

function buildSnippetCommand(
  snippet: Snippet,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void,
  translate: (key: string) => string
): CommandEntry {
  return {
    id: `sn-${snippet.id}`,
    category: 'snippet',
    label: snippet.label,
    description: snippet.description || translate('commandPalette.snippet.fallbackDescription'),
    language: snippet.language,
    keywords: normalizeKeywords([snippet.label, snippet.language, snippet.description]),
    action: () => {
      const tab = createDefaultTab(snippet.language);
      createTab({
        ...tab,
        content: snippet.code,
        name: `${snippet.label}.${extensionForLanguage(snippet.language)}`,
      });
      onClose();
    },
  };
}

function buildActionCommand(
  id: string,
  label: string,
  description: string,
  keywords: string[],
  action: () => void
): CommandEntry {
  return {
    id,
    category: 'action',
    label,
    description,
    keywords: normalizeKeywords(keywords),
    action,
  };
}

/**
 * Minimal fallback when no TFunction is supplied — returns the last segment
 * of the key in Title Case so legacy callers still render something readable
 * rather than a raw dot-notation string.
 */
function identityTranslate(key: string): string {
  const segment = key.split('.').pop() ?? key;
  return segment.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/**
 * RL-028 third slice — surface up to 5 recent runs as palette actions.
 * Label format is `{{language}} · {{status}} · {{duration}}`,
 * all localized. `onFocusLanguageTab` is optional; when it's missing
 * the action just closes the palette (a harmless "I saw the entry"
 * acknowledgement, same as every other palette item without a caller).
 */
const MAX_RECENT_RUNS_IN_PALETTE = 5;

function buildRecentRunCommand(
  entry: ExecutionHistoryEntry,
  onClose: () => void,
  translate: (key: string, options?: Record<string, unknown>) => string,
  onFocusLanguageTab?: (language: Language) => void
): CommandEntry {
  const statusKey =
    entry.status === 'ok'
      ? 'commandPalette.recentRuns.status.ok'
      : 'commandPalette.recentRuns.status.error';
  const languageName = languageLabel(entry.language as Language);
  const label = translate('commandPalette.recentRuns.label', {
    language: languageName,
    status: translate(statusKey),
    duration: formatExecTime(entry.durationMs ?? 0),
  });
  const description = translate('commandPalette.recentRuns.description');

  return {
    id: `recent-run-${entry.id}`,
    category: 'action',
    label,
    description,
    language: entry.language as Language,
    keywords: normalizeKeywords([
      label,
      description,
      entry.language,
      entry.status,
      'recent',
      'run',
    ]),
    action: () => {
      onFocusLanguageTab?.(entry.language as Language);
      onClose();
    },
  };
}

/**
 * RL-020 Slice 4 fold G — parallel "Recent runs (this tab)" entry.
 * Same shape as `buildRecentRunCommand` but labels itself with a
 * dedicated copy key so the palette result list visibly distinguishes
 * per-tab entries from the legacy global group. The action is
 * identical (focuses the language tab), letting users use either
 * group interchangeably.
 */
function buildRecentRunOnTabCommand(
  entry: ExecutionHistoryEntry,
  onClose: () => void,
  translate: (key: string, options?: Record<string, unknown>) => string,
  onFocusLanguageTab?: (language: Language) => void
): CommandEntry {
  const statusKey =
    entry.status === 'ok'
      ? 'commandPalette.recentRuns.status.ok'
      : 'commandPalette.recentRuns.status.error';
  const languageName = languageLabel(entry.language as Language);
  const label = translate('commandPalette.recentRuns.onTab.label', {
    language: languageName,
    status: translate(statusKey),
    duration: formatExecTime(entry.durationMs ?? 0),
  });
  const description = translate('commandPalette.recentRuns.onTab.description');

  return {
    id: `recent-run-tab-${entry.id}`,
    category: 'action',
    label,
    description,
    language: entry.language as Language,
    keywords: normalizeKeywords([
      label,
      description,
      entry.language,
      entry.status,
      'recent',
      'run',
      'tab',
      'this',
    ]),
    action: () => {
      onFocusLanguageTab?.(entry.language as Language);
      onClose();
    },
  };
}

/**
 * RL-028 Slice 6 trailer — per-entry Replay command.
 *
 * Emitted only for snapshot-bearing entries so the user can fuzzy-search
 * "replay python ok 1.2s" and re-run any of the recent captures from the
 * keyboard. The popover Replay button covers the same intent for mouse
 * users; the palette mirror keeps the keyboard-driven flow first-class
 * for Lingua's senior-dev audience.
 *
 * Activation hands the entry to `onReplayEntry`, which is wired in
 * `App.tsx` to the shared `replayHistoryEntry` helper. The helper
 * runs with `lifecycle.recordHistory: false` so no second history
 * entry is appended.
 */
function buildReplayHistoryCommand(
  entry: ExecutionHistoryEntry,
  onClose: () => void,
  translate: (key: string, options?: Record<string, unknown>) => string,
  onReplayEntry: (entry: ExecutionHistoryEntry) => void
): CommandEntry {
  const statusKey =
    entry.status === 'ok'
      ? 'commandPalette.recentRuns.status.ok'
      : 'commandPalette.recentRuns.status.error';
  const languageName = languageLabel(entry.language as Language);
  const label = translate('executionHistory.palette.replay.label', {
    language: languageName,
    status: translate(statusKey),
    duration: formatExecTime(entry.durationMs ?? 0),
  });
  const description = translate('executionHistory.palette.replay.description');

  return {
    id: `action-replay-${entry.id}`,
    category: 'action',
    label,
    description,
    language: entry.language as Language,
    keywords: normalizeKeywords([
      label,
      description,
      entry.language,
      entry.status,
      'replay',
      'snapshot',
      'history',
      'recent',
      'run',
      'reproduce',
    ]),
    action: () => {
      onReplayEntry(entry);
      onClose();
    },
  };
}

export function buildCommandPaletteModel({
  templates,
  snippets,
  executionHistory,
  onFocusLanguageTab,
  onRerunLast,
  onReplayEntry,
  onToggleVimMode,
  vimModeEnabled = false,
  onSetRuntimeMode,
  activeRuntimeMode = null,
  onAddWatchToCurrentLine,
  activeWatchLanguage = null,
  onToggleAutoLogOnActiveTab,
  activeAutoLogResolved = false,
  onFocusStdinPanel,
  stdinPanelAvailable = false,
  onSetActiveLanguageTimeoutPreset,
  activeTimeoutLanguage = null,
  activeTimeoutPreset = null,
  onRunWithExtendedTimeout,
  onToggleCompareWithSnapshot,
  activeCompareEnabled = false,
  compareSnapshotAvailable = false,
  onToggleVariableInspector,
  activeVariableInspectorEnabled = false,
  variableInspectorScopeAvailable = false,
  onToggleConsoleRichRendering,
  consoleRichRenderingEnabled = true,
  activeTabId = null,
  updateStatus,
  createTab,
  createDefaultTab,
  setLayoutPreset,
  onClose,
  onOpenSettings,
  onOpenWhatsNew,
  onStartGuidedTour,
  onOpenSnippets,
  onOpenProjectSearch,
  onOpenGoToSymbol,
  onOpenDeveloperUtility,
  onOpenKeyboardShortcuts,
  checkForUpdates,
  restartToApply,
  openFileFromDisk,
  saveActiveTabAs,
  duplicateActiveTab,
  onExportLatestCapsule,
  latestCapsuleAvailable = false,
  onShowLanguageSupport,
  onCopyLanguageScorecardMarkdown,
  onCopyShareLink,
  onReplayOnboardingWelcome,
  onReplayOnboardingFirstRun,
  onReplayOnboardingFirstSnippet,
  onShowPrivacyDashboard,
  onShowDependencies,
  onToggleOutputSourceMapping,
  t,
}: BuildCommandPaletteModelArgs): CommandEntry[] {
  const translate: (key: string, options?: Record<string, unknown>) => string = t
    ? (key, options) => t(key, options) as unknown as string
    : (key) => identityTranslate(key);

  const restartDescription = translate(
    updateStatus === 'downloaded'
      ? 'commandPalette.action.restartUpdate.descriptionReady'
      : 'commandPalette.action.restartUpdate.descriptionPending'
  );

  const recentRunEntries = (executionHistory ?? [])
    // Store keeps entries oldest → newest; palette wants newest first.
    .slice(-MAX_RECENT_RUNS_IN_PALETTE)
    .reverse();

  // RL-020 Slice 4 fold G — per-tab recent runs ranked above the
  // global group when the active tab has at least one matching
  // entry. Same `MAX_RECENT_RUNS_IN_PALETTE` ceiling so neither
  // group dominates the palette.
  const recentRunOnTabEntries =
    activeTabId !== null && activeTabId !== undefined
      ? (executionHistory ?? [])
          .filter((entry) => entry.tabId === activeTabId)
          .slice(-MAX_RECENT_RUNS_IN_PALETTE)
          .reverse()
      : [];

  // Per-entry Replay commands share the same recent-history window before
  // metadata-only entries drop out, so stale snapshots cannot outrank the
  // latest executions just because newer entries did not capture code.
  const replayHistoryEntries = onReplayEntry
    ? (executionHistory ?? [])
        .slice(-MAX_RECENT_RUNS_IN_PALETTE)
        .filter((entry) => entry.snapshot !== null)
        .reverse()
    : [];

  const commands: CommandEntry[] = [
    ...templates.map((template) =>
      buildTemplateCommand(template, createTab, createDefaultTab, onClose, t)
    ),
    ...snippets.map((snippet) =>
      buildSnippetCommand(snippet, createTab, createDefaultTab, onClose, translate)
    ),
    // RL-020 Slice 4 fold G — per-tab group FIRST so the user sees
    // "what I just ran on this tab" before the global recents.
    ...recentRunOnTabEntries.map((entry) =>
      buildRecentRunOnTabCommand(entry, onClose, translate, onFocusLanguageTab)
    ),
    ...recentRunEntries.map((entry) =>
      buildRecentRunCommand(entry, onClose, translate, onFocusLanguageTab)
    ),
    ...replayHistoryEntries.map((entry) =>
      buildReplayHistoryCommand(
        entry,
        onClose,
        translate,
        onReplayEntry as (entry: ExecutionHistoryEntry) => void
      )
    ),
    // RL-028 fourth slice — Re-run last execution. Hidden when the
    // caller does not wire `onRerunLast` so legacy callers (or
    // surfaces with no execution context) keep working.
    ...(onRerunLast
      ? [
          buildActionCommand(
            'action-rerun-last',
            translate('commandPalette.action.rerunLast.label'),
            translate('commandPalette.action.rerunLast.description'),
            ['rerun', 'replay', 'last', 'recent', 'run'],
            () => {
              onRerunLast();
              onClose();
            }
          ),
        ]
      : []),
    // RL-094 Slice 1 fold B — Export latest run as capsule. Surfaces
    // only when the caller wires the handler AND the history store
    // confirms at least one entry still carries a `lastCapsule`. Hiding
    // the entry when no capsule exists keeps the palette honest about
    // what the action would do.
    ...(onExportLatestCapsule && latestCapsuleAvailable
      ? [
          buildActionCommand(
            'action-export-capsule',
            translate('commandPalette.action.exportCapsule.label'),
            translate('commandPalette.action.exportCapsule.description'),
            ['capsule', 'export', 'run', 'share', 'json', 'replay'],
            () => {
              onExportLatestCapsule();
              onClose();
            }
          ),
        ]
      : []),
    // RL-095 Slice 1 fold B — opens Settings on the Languages tab and
    // scrolls to the scorecard. `onClose()` MUST run before the user
    // callback: both helpers set the single `overlay` slot in App
    // state, and within one React event handler the last setState
    // call wins the batch. Closing the palette first and opening
    // Settings second matches the established pattern in
    // `action-settings` / `action-about` so the new overlay survives.
    ...(onShowLanguageSupport
      ? [
          buildActionCommand(
            'action-show-language-support',
            translate('commandPalette.action.showLanguageSupport.label'),
            translate('commandPalette.action.showLanguageSupport.description'),
            ['language', 'support', 'scorecard', 'matrix', 'lenguajes'],
            () => {
              onClose();
              onShowLanguageSupport();
            }
          ),
        ]
      : []),
    // RL-095 Slice 1 fold F — copies the markdown rendering of the
    // scorecard so users can paste into issues / PRs / docs.
    ...(onCopyLanguageScorecardMarkdown
      ? [
          buildActionCommand(
            'action-copy-language-scorecard-markdown',
            translate('commandPalette.action.copyLanguageScorecardMarkdown.label'),
            translate('commandPalette.action.copyLanguageScorecardMarkdown.description'),
            ['language', 'scorecard', 'markdown', 'copy', 'lenguajes', 'tabla'],
            () => {
              onCopyLanguageScorecardMarkdown();
              onClose();
            }
          ),
        ]
      : []),
    // RL-036 Phase A1 fold C — copies a share-link URL fragment that
    // recreates the active tab. The user callback may surface the
    // confirmation modal (fold A); we close the palette FIRST so
    // both overlays don't compete for the same App state slot
    // (same overlay-survival pattern as `action-settings`).
    ...(onCopyShareLink
      ? [
          buildActionCommand(
            'action-copy-share-link',
            translate('commandPalette.action.copyShareLink.label'),
            translate('commandPalette.action.copyShareLink.description'),
            [
              'share',
              'link',
              'url',
              'compartir',
              'enlace',
              'copy',
              'copia',
            ],
            () => {
              onClose();
              onCopyShareLink();
            }
          ),
        ]
      : []),
    // RL-101 Slice 1 fold G — three palette entries, one per stage.
    // Each closes the palette FIRST, then runs the reset callback so
    // any follow-up status notice the renderer emits doesn't compete
    // with the palette overlay for the same App state slot.
    ...(onReplayOnboardingWelcome
      ? [
          buildActionCommand(
            'action-replay-onboarding-welcome',
            translate('onboarding.palette.rearmWelcome.label'),
            translate('onboarding.palette.rearmWelcome.description'),
            ['onboarding', 'welcome', 'inicio', 'guiado', 'replay', 'reset'],
            () => {
              onClose();
              onReplayOnboardingWelcome();
            }
          ),
        ]
      : []),
    ...(onReplayOnboardingFirstRun
      ? [
          buildActionCommand(
            'action-replay-onboarding-first-run',
            translate('onboarding.palette.rearmFirstRun.label'),
            translate('onboarding.palette.rearmFirstRun.description'),
            ['onboarding', 'first', 'run', 'tip', 'rearm', 'reset'],
            () => {
              onClose();
              onReplayOnboardingFirstRun();
            }
          ),
        ]
      : []),
    ...(onReplayOnboardingFirstSnippet
      ? [
          buildActionCommand(
            'action-replay-onboarding-first-snippet',
            translate('onboarding.palette.rearmFirstSnippet.label'),
            translate('onboarding.palette.rearmFirstSnippet.description'),
            ['onboarding', 'first', 'snippet', 'tip', 'rearm', 'reset'],
            () => {
              onClose();
              onReplayOnboardingFirstSnippet();
            }
          ),
        ]
      : []),
    // RL-096 Slice 1 fold B — palette entry that opens Settings on
    // the Privacy tab. Closes the palette FIRST so the Settings
    // overlay isn't competing with it for the App state slot. Same
    // overlay-survival pattern as `action-settings` and
    // `action-show-language-support`.
    ...(onShowPrivacyDashboard
      ? [
          buildActionCommand(
            'action-show-privacy-dashboard',
            translate('commandPalette.action.showPrivacyDashboard.label'),
            translate('commandPalette.action.showPrivacyDashboard.description'),
            [
              'privacy',
              'privacidad',
              'trust',
              'confianza',
              'redaction',
              'redaccion',
              'audit',
              'auditoria',
              'network',
              'red',
            ],
            () => {
              onClose();
              onShowPrivacyDashboard();
            }
          ),
        ]
      : []),
    // RL-025 Slice A fold C — opens the bottom-panel Dependencies
    // tab for the active file. Mirrors the `action-show-*` overlay
    // ordering: close the palette FIRST so the tab activation does
    // not compete with the palette overlay for the App state slot.
    ...(onShowDependencies
      ? [
          buildActionCommand(
            'action-show-dependencies',
            translate('commandPalette.action.showDependencies.label'),
            translate('commandPalette.action.showDependencies.description'),
            [
              'dependencies',
              'dependencias',
              'imports',
              'requires',
              'modules',
              'paquetes',
              'npm',
              'pip',
            ],
            () => {
              onClose();
              onShowDependencies();
            }
          ),
        ]
      : []),
    // RL-044 Sub-slice G Fold C — flips the master toggle for the
    // output→source line affordance. Keyword set covers EN + ES so
    // the palette finds it under "line badge", "output", "mapeo",
    // "origen", "chip" without forcing memorisation.
    ...(onToggleOutputSourceMapping
      ? [
          buildActionCommand(
            'action-toggle-output-source-mapping',
            translate('commandPalette.action.toggleOutputSourceMapping.label'),
            translate(
              'commandPalette.action.toggleOutputSourceMapping.description'
            ),
            [
              'output',
              'source',
              'origin',
              'line',
              'badge',
              'chip',
              'mapeo',
              'origen',
              'salida',
              'console',
              'consola',
            ],
            () => {
              onClose();
              onToggleOutputSourceMapping();
            }
          ),
        ]
      : []),
    // RL-020 Slice 3 fold E — "Pin watch on current line". Only
    // surfaces when the caller wires `onAddWatchToCurrentLine`
    // AND the active tab's language supports `@watch` (JS / TS /
    // Python). For other languages the action is hidden entirely
    // so the palette stays honest about what's possible.
    ...(onAddWatchToCurrentLine &&
    (activeWatchLanguage === 'javascript' ||
      activeWatchLanguage === 'typescript' ||
      activeWatchLanguage === 'python')
      ? [
          buildActionCommand(
            'action-add-watch',
            translate('commandPalette.action.addWatch.label'),
            translate('commandPalette.action.addWatch.description'),
            ['watch', 'pin', 'magic', 'comment', 'inline', 'expression'],
            () => {
              onAddWatchToCurrentLine();
              onClose();
            }
          ),
        ]
      : []),
    // RL-020 Slice 6 fold E — focus the Input bottom-panel tab from
    // the command palette. Hidden when the master toggle is OFF or
    // when the active tab's language doesn't support stdin.
    ...(onFocusStdinPanel && stdinPanelAvailable
      ? [
          buildActionCommand(
            'action-focus-stdin-panel',
            translate('commandPalette.action.toggleStdin.label'),
            translate('commandPalette.action.toggleStdin.shown'),
            ['stdin', 'input', 'panel', 'prompt', 'readline'],
            () => {
              onFocusStdinPanel();
              onClose();
            }
          ),
        ]
      : []),
    // RL-020 Slice 5 fold D — toggle auto-log on the active tab.
    // Only surfaces for JS / TS active tabs; non-JS/TS tabs hide
    // the entry entirely so the palette never advertises an action
    // it would refuse. Reuses the per-tab override path so the
    // toggle is scoped to one tab, not the global Settings default.
    ...(onToggleAutoLogOnActiveTab &&
    (activeWatchLanguage === 'javascript' ||
      activeWatchLanguage === 'typescript')
      ? [
          buildActionCommand(
            'action-toggle-auto-log',
            translate('commandPalette.action.toggleAutoLog.label'),
            translate(
              activeAutoLogResolved
                ? 'commandPalette.action.toggleAutoLog.enabled'
                : 'commandPalette.action.toggleAutoLog.disabled'
            ),
            ['auto-log', 'autolog', 'inline', 'expression', 'scratchpad', 'toggle'],
            () => {
              onToggleAutoLogOnActiveTab();
              onClose();
            }
          ),
        ]
      : []),
    // RL-020 Slice 7 fold C — "Set execution timeout: Quick / Normal /
    // Long / Extended" entries on the active language. Hidden when
    // the active language isn't in the supported set or when the
    // caller didn't wire `onSetActiveLanguageTimeoutPreset`. Active
    // preset is suffixed with " · current" so the user sees which is
    // selected without having to reach for Settings.
    ...(onSetActiveLanguageTimeoutPreset && activeTimeoutLanguage
      ? (['quick', 'normal', 'long', 'extended'] as const).map((preset) =>
          buildActionCommand(
            `action-set-timeout-${preset}`,
            translate(`commandPalette.action.setTimeout.${preset}.label`),
            preset === activeTimeoutPreset
              ? translate('commandPalette.action.setTimeout.activeDescription')
              : translate(`commandPalette.action.setTimeout.${preset}.description`),
            [
              'timeout',
              'preset',
              'execution',
              'run',
              'limit',
              'deadline',
              preset,
            ],
            () => {
              onSetActiveLanguageTimeoutPreset(preset);
              onClose();
            }
          )
        )
      : []),
    // RL-020 Slice 7 fold D — one-shot "Run with extended timeout".
    // Sets `nextRunTimeoutOverrideMs` on the active tab and
    // dispatches the run; the override is consumed once. Hidden when
    // the caller did not wire the handler or the active language is
    // outside the timeout-preset supported set.
    ...(onRunWithExtendedTimeout && activeTimeoutLanguage
      ? [
          buildActionCommand(
            'action-run-with-extended-timeout',
            translate('commandPalette.action.runExtendedTimeout.label'),
            translate('commandPalette.action.runExtendedTimeout.description'),
            ['run', 'extended', 'timeout', 'long', 'once', 'override'],
            () => {
              onRunWithExtendedTimeout();
              onClose();
            }
          ),
        ]
      : []),
    // RL-020 Slice 8 fold C — toggle the Compare panel on the
    // active tab. Hidden when there's no comparator snapshot for
    // the active language (matches the toggle-button gate). The
    // description flips between "Show" and "Hide" so the palette
    // honestly previews the next state.
    ...(onToggleCompareWithSnapshot && compareSnapshotAvailable
      ? [
          buildActionCommand(
            'action-toggle-compare-with-snapshot',
            translate('commandPalette.action.toggleCompare.label'),
            translate(
              activeCompareEnabled
                ? 'commandPalette.action.toggleCompare.descriptionHide'
                : 'commandPalette.action.toggleCompare.descriptionShow'
            ),
            ['compare', 'diff', 'snapshot', 'stable', 'previous', 'toggle'],
            () => {
              onToggleCompareWithSnapshot();
              onClose();
            }
          ),
        ]
      : []),
    // RL-020 Slice 9 fold B — toggle the variable inspector on the
    // active tab. Hidden when there's no scope snapshot for the
    // active language (matches the toggle-button gate). Description
    // flips between Show / Hide.
    ...(onToggleVariableInspector && variableInspectorScopeAvailable
      ? [
          buildActionCommand(
            'action-toggle-variable-inspector',
            translate('commandPalette.action.toggleVariableInspector.label'),
            translate(
              activeVariableInspectorEnabled
                ? 'commandPalette.action.toggleVariableInspector.descriptionHide'
                : 'commandPalette.action.toggleVariableInspector.descriptionShow'
            ),
            ['variables', 'inspector', 'scope', 'last', 'run', 'toggle'],
            () => {
              onToggleVariableInspector();
              onClose();
            }
          ),
        ]
      : []),
    // RL-044 Slice 1B fold B — toggle the rich console output dispatch.
    // Always available when wired (no scope / language gate).
    ...(onToggleConsoleRichRendering
      ? [
          buildActionCommand(
            'action-toggle-console-rich-rendering',
            translate('commandPalette.action.toggleConsoleRichRendering.label'),
            translate(
              consoleRichRenderingEnabled
                ? 'commandPalette.action.toggleConsoleRichRendering.descriptionDisable'
                : 'commandPalette.action.toggleConsoleRichRendering.descriptionEnable'
            ),
            ['console', 'rich', 'json', 'rendering', 'output', 'toggle', 'table'],
            () => {
              onToggleConsoleRichRendering();
              onClose();
            }
          ),
        ]
      : []),
    // RL-037 Vim slice — Toggle Vim mode. Hidden when the caller does
    // not wire `onToggleVimMode`; description text flips based on
    // `vimModeEnabled` so the palette honestly previews the next state.
    ...(onToggleVimMode
      ? [
          buildActionCommand(
            'action-toggle-vim-mode',
            translate('commandPalette.toggleVimMode.label'),
            translate(
              vimModeEnabled
                ? 'commandPalette.toggleVimMode.descriptionDisable'
                : 'commandPalette.toggleVimMode.descriptionEnable'
            ),
            ['vim', 'mode', 'keybindings', 'editor', 'toggle'],
            () => {
              onToggleVimMode();
              onClose();
            }
          ),
        ]
      : []),
    buildActionCommand(
      'action-layout-horizontal',
      translate('commandPalette.action.layout.horizontal.label'),
      translate('commandPalette.action.layout.horizontal.description'),
      ['layout', 'horizontal', 'split', 'console'],
      () => {
        setLayoutPreset('horizontal');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-vertical',
      translate('commandPalette.action.layout.vertical.label'),
      translate('commandPalette.action.layout.vertical.description'),
      ['layout', 'vertical', 'split'],
      () => {
        setLayoutPreset('vertical');
        onClose();
      }
    ),
    buildActionCommand(
      'action-layout-editor',
      translate('commandPalette.action.layout.editorOnly.label'),
      translate('commandPalette.action.layout.editorOnly.description'),
      ['layout', 'editor', 'only', 'hide', 'console'],
      () => {
        setLayoutPreset('editor-only');
        onClose();
      }
    ),
    buildActionCommand(
      'action-snippets',
      translate('commandPalette.action.snippets.label'),
      translate('commandPalette.action.snippets.description'),
      ['snippets', 'snippet', 'library', 'save snippet'],
      () => {
        onClose();
        onOpenSnippets();
      }
    ),
    // RL-019 Slice 1 fold E — Switch runtime to {Worker | Node |
    // Browser preview}. Only emitted when the caller wires
    // `onSetRuntimeMode` AND the active tab actually owns the
    // runtime-mode surface (JS/TS today, signalled by a non-null
    // `activeRuntimeMode`). `setTabRuntimeMode` remains the guard
    // for any future unimplemented mode.
    ...(onSetRuntimeMode && activeRuntimeMode !== null
      ? ([
          buildActionCommand(
            'action-runtime-mode-worker',
            translate('commandPalette.action.runtimeMode.worker.label'),
            translate('commandPalette.action.runtimeMode.worker.description'),
            ['runtime', 'mode', 'worker', 'sandbox', 'js', 'ts'],
            () => {
              onSetRuntimeMode('worker');
              onClose();
            }
          ),
          buildActionCommand(
            'action-runtime-mode-node',
            translate('commandPalette.action.runtimeMode.node.label'),
            translate('commandPalette.action.runtimeMode.node.description'),
            ['runtime', 'mode', 'node', 'desktop', 'fs', 'path'],
            () => {
              onSetRuntimeMode('node');
              onClose();
            }
          ),
          buildActionCommand(
            'action-runtime-mode-browser-preview',
            translate('commandPalette.action.runtimeMode.browserPreview.label'),
            translate('commandPalette.action.runtimeMode.browserPreview.description'),
            ['runtime', 'mode', 'browser', 'preview', 'iframe', 'dom'],
            () => {
              onSetRuntimeMode('browser-preview');
              onClose();
            }
          ),
        ] as CommandEntry[])
      : []),
    buildActionCommand(
      'action-about',
      translate('commandPalette.action.about.label'),
      translate('commandPalette.action.about.description'),
      ['about', 'lingua', 'version', 'license', 'github'],
      () => {
        onClose();
        onOpenSettings();
      }
    ),
    buildActionCommand(
      'action-whats-new',
      translate('commandPalette.action.whatsNew.label'),
      translate('commandPalette.action.whatsNew.description'),
      ['whats new', 'release notes', 'changelog', 'updates'],
      () => {
        onClose();
        onOpenWhatsNew();
      }
    ),
    buildActionCommand(
      'action-guided-tour',
      translate('commandPalette.action.guidedTour.label'),
      translate('commandPalette.action.guidedTour.description'),
      ['tour', 'guided', 'onboarding', 'help'],
      () => {
        onClose();
        onStartGuidedTour();
      }
    ),
    buildActionCommand(
      'action-settings',
      translate('commandPalette.action.settings.label'),
      translate('commandPalette.action.settings.description'),
      ['settings', 'preferences', 'theme', 'font'],
      () => {
        onClose();
        onOpenSettings();
      }
    ),
    buildActionCommand(
      'action-check-updates',
      translate('commandPalette.action.checkUpdates.label'),
      translate('commandPalette.action.checkUpdates.description'),
      ['updates', 'update', 'release', 'version'],
      () => {
        onClose();
        onOpenSettings();
        void checkForUpdates();
      }
    ),
    buildActionCommand(
      'action-restart-update',
      translate('commandPalette.action.restartUpdate.label'),
      restartDescription,
      ['updates', 'restart', 'apply', 'install'],
      () => {
        void restartToApply();
        onClose();
      }
    ),
  ];

  if (onOpenProjectSearch) {
    commands.push(
      buildActionCommand(
        'action-project-search',
        translate('commandPalette.action.projectSearch.label'),
        translate('commandPalette.action.projectSearch.description'),
        ['search', 'find', 'in files', 'grep', 'text'],
        () => {
          onClose();
          onOpenProjectSearch();
        }
      )
    );
  }

  if (onOpenGoToSymbol) {
    commands.push(
      buildActionCommand(
        'action-go-to-symbol',
        translate('commandPalette.action.goToSymbol.label'),
        translate('commandPalette.action.goToSymbol.description'),
        ['symbol', 'outline', 'function', 'class', 'method', 'navigate'],
        () => {
          onClose();
          onOpenGoToSymbol();
        }
      )
    );
  }

  if (onOpenDeveloperUtility) {
    commands.push(
      ...DEVELOPER_UTILITIES.map((utility) =>
        buildActionCommand(
          `action-developer-utility-${utility.id}`,
          translate(utility.actionLabelKey),
          translate(utility.descriptionKey),
          [...utility.keywords, ...(utility.aliases ?? []), 'utility', 'developer', 'tool'],
          () => {
            onClose();
            onOpenDeveloperUtility(utility.id);
          }
        )
      )
    );
  }

  if (onOpenKeyboardShortcuts) {
    commands.push(
      buildActionCommand(
        'action-keyboard-shortcuts',
        translate('commandPalette.action.keyboardShortcuts.label'),
        translate('commandPalette.action.keyboardShortcuts.description'),
        ['keyboard', 'shortcuts', 'keybindings', 'hotkeys', 'help'],
        () => {
          onClose();
          onOpenKeyboardShortcuts();
        }
      )
    );
  }

  if (openFileFromDisk) {
    commands.push(
      buildActionCommand(
        'action-open-file',
        translate('commandPalette.action.openFile.label'),
        translate('commandPalette.action.openFile.description'),
        ['open', 'file', 'disk', 'browse'],
        () => {
          void openFileFromDisk();
          onClose();
        }
      )
    );
  }

  if (saveActiveTabAs) {
    commands.push(
      buildActionCommand(
        'action-save-as',
        translate('commandPalette.action.saveAs.label'),
        translate('commandPalette.action.saveAs.description'),
        ['save as', 'save copy', 'export'],
        () => {
          void saveActiveTabAs();
          onClose();
        }
      )
    );
  }

  if (duplicateActiveTab) {
    commands.push(
      buildActionCommand(
        'action-duplicate-tab',
        translate('commandPalette.action.duplicateTab.label'),
        translate('commandPalette.action.duplicateTab.description'),
        ['duplicate', 'copy', 'tab', 'clone'],
        () => {
          duplicateActiveTab();
          onClose();
        }
      )
    );
  }

  return commands;
}

export function filterCommandPaletteCommands(
  commands: CommandEntry[],
  query: string
): CommandEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter(
    (command) =>
      command.keywords.some((keyword) => keyword.includes(normalizedQuery)) ||
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.description.toLowerCase().includes(normalizedQuery)
  );
}

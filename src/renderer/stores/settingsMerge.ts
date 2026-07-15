import type { SettingsState } from '../types';
import { currentEffectiveTier } from './licenseSelectors';
import {
  DEFAULT_KEYMAP_PRESET_ID,
  findKeymapPreset,
  isKnownKeymapPresetId,
} from '../data/keymapPresets';
import {
  DEFAULT_THEME_PACK_ID,
  findThemePack,
  isKnownThemePackId,
} from '../data/themePacks';
import { isRuntimeModeImplemented } from '../../shared/runtimeModes';
import {
  defaultRuntimeTimeoutPresetSeed,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import { type WorkflowMode } from '../../shared/workflowMode';
import { sanitizeBrowserPreviewRefreshInterval } from '../../shared/browserPreviewRefresh';
import {
  SCRATCHPAD_AUTO_LOG_DEFAULT_SEED,
  WORKFLOW_MODE_DEFAULT_SEED,
} from './settingsDefaults';
import {
  hasOwn,
  isAppLanguage,
  resolveInlineLintByLanguage,
  sanitizeRuntimeTimeoutPresets,
  sanitizeScorecardPlatform,
  sanitizeScratchpadAutoLog,
  sanitizeSensitiveHttpHeaders,
  sanitizeShortcutOverrides,
  sanitizeSqlQueryTimeoutMs,
  sanitizeSqlRowDisplayLimit,
  sanitizeWorkflowModeDefaults,
  shortcutOverridesEqual,
  themePackAppearanceMatchesSettings,
} from './settingsSanitizers';

/**
 * RL-129 — the `lingua-settings` rehydrate sanitizer, extracted verbatim from
 * `settingsStore.ts` (the inline per-field IIFE sanitizers now live in
 * `settingsSanitizers.ts`). `persistedState` is attacker/tamper-controlled input
 * from localStorage, so every enum / map / number is narrowed before it can
 * influence Settings UI, runtime dispatch, or telemetry payloads. Pure (modulo
 * the `currentEffectiveTier()` read for the dependency-detection default);
 * depends only on sanitizers + defaults + shared contracts, never on the store.
 */
export function settingsMerge(
  persistedState: unknown,
  currentState: SettingsState
): SettingsState {
  const persisted = persistedState && typeof persistedState === 'object'
    ? (persistedState as Partial<SettingsState>) : undefined;
  const merged = {
    ...currentState,
    ...persisted,
  };
  const hasSnapshotPreference =
    persisted != null && hasOwn(persisted, 'executionHistorySnapshotEnabled');
  const executionHistorySnapshotEnabled =
    typeof persisted?.executionHistorySnapshotEnabled === 'boolean'
      ? persisted.executionHistorySnapshotEnabled
      : hasSnapshotPreference
        ? false
        : currentState.executionHistorySnapshotEnabled;
  // RL-025 Slice A fold G — tier-aware default for the
  // dependency detection toggle. A present-but-non-boolean value
  // (corrupted write, future schema drift) falls back to the
  // tier-aware default exactly like an absent key, so the
  // surface never silently lands at `false` for someone who
  // shouldn't get the upsell-pressure default.
  const dependencyDetectionEnabled =
    typeof persisted?.dependencyDetectionEnabled === 'boolean'
      ? persisted.dependencyDetectionEnabled
      : currentEffectiveTier() === 'free'
        ? false
        : currentState.dependencyDetectionEnabled;
  const hasNativeExecutionAcknowledgement =
    persisted != null && hasOwn(persisted, 'nativeExecutionAcknowledged');
  const nativeExecutionAcknowledged =
    typeof persisted?.nativeExecutionAcknowledged === 'boolean'
      ? persisted.nativeExecutionAcknowledged
      : hasNativeExecutionAcknowledgement
        ? false
        : currentState.nativeExecutionAcknowledged;
  const shortcutOverrides = sanitizeShortcutOverrides(merged.shortcutOverrides);
  const requestedKeymapPreset = isKnownKeymapPresetId(merged.keymapPreset)
    ? merged.keymapPreset
    : DEFAULT_KEYMAP_PRESET_ID;
  const normalizedKeymapPreset =
    requestedKeymapPreset === DEFAULT_KEYMAP_PRESET_ID
      ? DEFAULT_KEYMAP_PRESET_ID
      : shortcutOverridesEqual(
            shortcutOverrides,
            findKeymapPreset(requestedKeymapPreset)?.overrides ?? {}
          )
        ? requestedKeymapPreset
        : DEFAULT_KEYMAP_PRESET_ID;
  const requestedThemePack = isKnownThemePackId(merged.themePack)
    ? merged.themePack
    : DEFAULT_THEME_PACK_ID;
  // RL-097 Slice 1 — sanitize the user's sensitive header allowlist on
  // rehydrate (drop non-strings, empties, >100 chars, baseline names,
  // case-insensitive dupes).
  const sanitizedSensitiveHttpHeaders = sanitizeSensitiveHttpHeaders(
    merged.sensitiveHttpHeaders
  );
  // RL-097 Slice 2 — sanitize SQL workspace prefs on rehydrate.
  // Closed-enum values fall back to defaults on drift.
  const sanitizedSqlRowDisplayLimit = sanitizeSqlRowDisplayLimit(
    merged.sqlWorkspaceRowDisplayLimit
  );
  const sanitizedSqlQueryTimeoutMs = sanitizeSqlQueryTimeoutMs(
    merged.sqlWorkspaceQueryTimeoutMs
  );
  const normalizedThemePack =
    requestedThemePack === DEFAULT_THEME_PACK_ID
      ? DEFAULT_THEME_PACK_ID
      : themePackAppearanceMatchesSettings(
            {
              theme: merged.theme,
              editorTheme: merged.editorTheme,
              fontFamily: merged.fontFamily,
              fontSize: merged.fontSize,
              layoutPreset: merged.layoutPreset,
            },
            findThemePack(requestedThemePack)?.appearance ?? {
              theme: currentState.theme,
              editorTheme: currentState.editorTheme,
              fontFamily: currentState.fontFamily,
              fontSize: currentState.fontSize,
              layoutPreset: currentState.layoutPreset,
            }
          )
        ? requestedThemePack
        : DEFAULT_THEME_PACK_ID;

  // RL-019 Slice 1 — guard `defaultRuntimeMode` on rehydrate the same
  // way `setDefaultRuntimeMode` does at runtime. A tampered localStorage
  // entry with an unimplemented or unknown string would otherwise
  // survive into the live store and surface a broken Select in Settings.
  const normalizedDefaultRuntimeMode =
    typeof merged.defaultRuntimeMode === 'string' &&
    isRuntimeModeImplemented(merged.defaultRuntimeMode as never)
      ? merged.defaultRuntimeMode
      : currentState.defaultRuntimeMode;
  // RL-020 Slice 2 fold C — sanitize the persisted defaults
  // map and seed any missing Scratchpad-language keys so the
  // Settings UI surfaces a populated row on upgrade. The
  // user's prior overrides win over the seed; the seed only
  // fills BLANK slots.
  const sanitizedWorkflowDefaults = sanitizeWorkflowModeDefaults(
    merged.workflowModeDefaultsByLanguage
  );
  const seededWorkflowDefaults: Record<string, WorkflowMode> = {
    ...WORKFLOW_MODE_DEFAULT_SEED,
    ...sanitizedWorkflowDefaults,
  };
  // RL-020 Slice 5 — sanitize the auto-log map the same way the
  // workflow defaults are sanitized + seeded on rehydrate. A
  // tampered persisted entry never survives into the live store
  // and missing keys default to `false`.
  const sanitizedAutoLog = sanitizeScratchpadAutoLog(
    merged.scratchpadAutoLogByLanguage
  );
  const seededAutoLog: Record<string, boolean> = {
    ...SCRATCHPAD_AUTO_LOG_DEFAULT_SEED,
    ...sanitizedAutoLog,
  };
  const firstWorkflowModeSwitchAcknowledged =
    typeof merged.firstWorkflowModeSwitchAcknowledged === 'boolean'
      ? merged.firstWorkflowModeSwitchAcknowledged
      : currentState.firstWorkflowModeSwitchAcknowledged;
  const showStdinPanel = typeof merged.showStdinPanel === 'boolean' ? merged.showStdinPanel : currentState.showStdinPanel;
  // RL-093 Slice 3 — guard the closed enum on rehydrate so a
  // tampered localStorage entry can't surface a broken
  // dropdown / route to a non-existent panel.
  const variableInspectorSurface: 'floating' | 'bottom' =
    merged.variableInspectorSurface === 'floating' ||
    merged.variableInspectorSurface === 'bottom'
      ? merged.variableInspectorSurface
      : currentState.variableInspectorSurface;
  // RL-020 Slice 7 — sanitize + seed the per-language preset
  // map. Tampered tokens never survive; missing language keys
  // fall back to the language default seed so the Settings UI
  // always shows a row for every supported language.
  const sanitizedTimeoutPresets = sanitizeRuntimeTimeoutPresets(
    merged.runtimeTimeoutPresetByLanguage
  );
  const seededTimeoutPresets: Record<string, RuntimeTimeoutPreset> = {
    ...defaultRuntimeTimeoutPresetSeed(),
    ...sanitizedTimeoutPresets,
  };
  const showTimeoutCountdown =
    typeof merged.showTimeoutCountdown === 'boolean'
      ? merged.showTimeoutCountdown
      : currentState.showTimeoutCountdown;
  // RL-042 Slice 6 — same guard as the boolean above. Anything
  // outside the closed enum (`auto` / `system` / `wasm`) gets
  // mapped back to the seed.
  const rubyRuntimePreference: 'auto' | 'system' | 'wasm' =
    merged.rubyRuntimePreference === 'auto' ||
    merged.rubyRuntimePreference === 'system' ||
    merged.rubyRuntimePreference === 'wasm'
      ? merged.rubyRuntimePreference
      : currentState.rubyRuntimePreference;
  // RL-101 Slice 1 — sanitize the onboarding choreography flags.
  // Tampered entries (null, string, undefined) fall back to the
  // initial `false` so the user always sees the welcome flow
  // exactly once. The seed-version tracker also defaults to 0
  // so any non-finite persisted value re-arms the seed.
  const hasCompletedOnboardingWelcome =
    typeof merged.hasCompletedOnboardingWelcome === 'boolean'
      ? merged.hasCompletedOnboardingWelcome
      : currentState.hasCompletedOnboardingWelcome;
  const hasCompletedOnboardingFirstRun =
    typeof merged.hasCompletedOnboardingFirstRun === 'boolean'
      ? merged.hasCompletedOnboardingFirstRun
      : currentState.hasCompletedOnboardingFirstRun;
  const hasCompletedOnboardingFirstSnippet =
    typeof merged.hasCompletedOnboardingFirstSnippet === 'boolean'
      ? merged.hasCompletedOnboardingFirstSnippet
      : currentState.hasCompletedOnboardingFirstSnippet;
  const onboardingWelcomeSeedVersion =
    typeof merged.onboardingWelcomeSeedVersion === 'number' &&
    Number.isFinite(merged.onboardingWelcomeSeedVersion) &&
    merged.onboardingWelcomeSeedVersion >= 0
      ? Math.floor(merged.onboardingWelcomeSeedVersion)
      : currentState.onboardingWelcomeSeedVersion;
  // RL-094 Slice 2 fold C — guard the capsule-import clipboard
  // consent on rehydrate so a tampered localStorage value can
  // never silently bypass the opt-in. Closed enum:
  // 'unset' | 'granted' | 'declined'. Anything else falls back
  // to `'unset'` so the user is prompted again.
  const capsuleImportClipboardOnFocusConsent: 'unset' | 'granted' | 'declined' =
    merged.capsuleImportClipboardOnFocusConsent === 'granted' ||
    merged.capsuleImportClipboardOnFocusConsent === 'declined' ||
    merged.capsuleImportClipboardOnFocusConsent === 'unset'
      ? merged.capsuleImportClipboardOnFocusConsent
      : 'unset';
  // RL-100 Slice 1 fold F — same three-state sanitize as the
  // capsule-import + utilities consents. Anything else falls
  // back to `'unset'` so the user is prompted again in Slice 2.
  const importPreviewClipboardOnFocusConsent: 'unset' | 'granted' | 'declined' =
    merged.importPreviewClipboardOnFocusConsent === 'granted' ||
    merged.importPreviewClipboardOnFocusConsent === 'declined' ||
    merged.importPreviewClipboardOnFocusConsent === 'unset'
      ? merged.importPreviewClipboardOnFocusConsent
      : 'unset';
  // RL-111 — guard the session-restore mode on rehydrate. The v1->v2
  // migration converts the legacy `restoreSession` boolean, but a
  // tampered / hand-edited localStorage value (or a blob that skipped
  // migration) must still coerce to a known enum. Unknown -> the
  // privacy-conscious `'ask'` default rather than silent auto-restore.
  const restoreSessionMode: SettingsState['restoreSessionMode'] =
    merged.restoreSessionMode === 'never' ||
    merged.restoreSessionMode === 'ask' ||
    merged.restoreSessionMode === 'always'
      ? merged.restoreSessionMode
      : 'ask';
  return {
    ...merged,
    restoreSessionMode,
    languageScorecardPlatform: sanitizeScorecardPlatform(merged.languageScorecardPlatform), // RL-095 S2
    hasCompletedOnboardingWelcome,
    hasCompletedOnboardingFirstRun,
    hasCompletedOnboardingFirstSnippet,
    onboardingWelcomeSeedVersion,
    language: isAppLanguage(merged.language) ? merged.language : currentState.language,
    executionHistorySnapshotEnabled,
    dependencyDetectionEnabled,
    nativeExecutionAcknowledged,
    shortcutOverrides,
    keymapPreset: normalizedKeymapPreset,
    themePack: normalizedThemePack,
    defaultRuntimeMode: normalizedDefaultRuntimeMode,
    workflowModeDefaultsByLanguage: seededWorkflowDefaults,
    scratchpadAutoLogByLanguage: seededAutoLog,
    browserPreviewRefreshIntervalMs: sanitizeBrowserPreviewRefreshInterval(merged.browserPreviewRefreshIntervalMs),
    inlineLintEnabledByLanguage: resolveInlineLintByLanguage(merged.inlineLintEnabledByLanguage),
    showStdinPanel,
    showStatusBar: typeof merged.showStatusBar === 'boolean' ? merged.showStatusBar : currentState.showStatusBar, // RL-112
    smartPasteDetectionEnabled: typeof merged.smartPasteDetectionEnabled === 'boolean' ? merged.smartPasteDetectionEnabled : currentState.smartPasteDetectionEnabled,
    variableInspectorSurface,
    runtimeTimeoutPresetByLanguage: seededTimeoutPresets,
    showTimeoutCountdown,
    rubyRuntimePreference,
    firstWorkflowModeSwitchAcknowledged,
    sensitiveHttpHeaders: sanitizedSensitiveHttpHeaders,
    sqlWorkspaceRowDisplayLimit: sanitizedSqlRowDisplayLimit,
    sqlWorkspaceQueryTimeoutMs: sanitizedSqlQueryTimeoutMs,
    sqlWorkspacePersistTables: merged.sqlWorkspacePersistTables === true, // RL-097 S3 OPFS: coerce to boolean on rehydrate
    runLedgerEnabled: merged.runLedgerEnabled === true, // IT2-C1: coerce to boolean on rehydrate
    notebookDefaultCellLanguage: merged.notebookDefaultCellLanguage === 'typescript' ? 'typescript' : 'javascript', // RL-043 SC: only the runnable pair; anything else falls back to JS
    capsuleImportClipboardOnFocusConsent,
    importPreviewClipboardOnFocusConsent,
  };
}

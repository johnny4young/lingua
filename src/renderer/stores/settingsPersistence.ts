import type { SettingsState } from '../types';

/**
 * internal — settings persist-boundary helpers, extracted verbatim from
 * `settingsStore.ts`: the `partialize` durable-field projection and the
 * consent-mirror side-effect. The rehydrate sanitizer (`merge`) lives in
 * `settingsMerge.ts`; `onRehydrateStorage` stays inline in the assembly (it is
 * a 3-line call into `syncConsentMirror`). Depends only on the `SettingsState`
 * type and the `window.lingua.consent` bridge — never on the store or actions.
 */

/**
 * Mirror the telemetry consent to the main process so `bootCrashReporter` can
 * read it at the next app boot, before `createWindow()`. Best-effort: a mirror
 * failure must never break the renderer. Called both by `setTelemetryConsent`
 * and by `onRehydrateStorage` after every startup rehydrate.
 */
export function syncConsentMirror(
  telemetryConsent: SettingsState['telemetryConsent']
): void {
  const bridge = typeof window !== 'undefined' ? window.lingua?.consent : undefined;
  if (!bridge) {
    return;
  }
  void bridge.set(telemetryConsent).catch(() => {
    // Best-effort only; a mirror failure must never break the renderer.
  });
}

/**
 * Durable schema for `lingua-settings`. Keep this list explicit so new
 * runtime-only helpers/functions do not accidentally become localStorage state
 * just because they were added to `SettingsState`. The companion
 * `settingsMerge` re-validates the untrusted maps, enums, and bounded values
 * when they rehydrate.
 */
export function settingsPartialize(state: SettingsState) {
  return {
    theme: state.theme,
    editorTheme: state.editorTheme,
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
    wordWrap: state.wordWrap,
    minimap: state.minimap,
    layoutPreset: state.layoutPreset,
    maxLoopIterations: state.maxLoopIterations,
    restoreSessionMode: state.restoreSessionMode,
    languageScorecardPlatform: state.languageScorecardPlatform,
    formatOnSave: state.formatOnSave,
    smartPasteDetectionEnabled: state.smartPasteDetectionEnabled,
    vimMode: state.vimMode,
    nativeExecutionAcknowledged: state.nativeExecutionAcknowledged,
    executionHistorySnapshotEnabled: state.executionHistorySnapshotEnabled,
    telemetryConsent: state.telemetryConsent,
    utilitiesClipboardOnFocusConsent: state.utilitiesClipboardOnFocusConsent,
    // implementation note — persist consent so opted-in users
    // don't have to re-grant every reload.
    capsuleImportClipboardOnFocusConsent:
      state.capsuleImportClipboardOnFocusConsent,
    // implementation note — persist the import-preview consent
    // so the user's choice survives reloads.
    importPreviewClipboardOnFocusConsent:
      state.importPreviewClipboardOnFocusConsent,
    // implementation — persist the dependency-detection toggle so
    // the user's choice survives reloads. Rehydrate-merge applies
    // the implementation note tier-aware default when this key is absent.
    dependencyDetectionEnabled: state.dependencyDetectionEnabled,
    defaultRuntimeMode: state.defaultRuntimeMode,
    workflowModeDefaultsByLanguage: state.workflowModeDefaultsByLanguage,
    scratchpadAutoLogByLanguage: state.scratchpadAutoLogByLanguage,
    browserPreviewRefreshIntervalMs: state.browserPreviewRefreshIntervalMs,
    inlineLintEnabledByLanguage: state.inlineLintEnabledByLanguage,
    showStdinPanel: state.showStdinPanel,
    // internal — persist the status-bar visibility so the user's choice
    // survives reloads. Rehydrate-merge falls back to the platform default
    // when this key is absent.
    showStatusBar: state.showStatusBar,
    variableInspectorSurface: state.variableInspectorSurface,
    runtimeTimeoutPresetByLanguage: state.runtimeTimeoutPresetByLanguage,
    showTimeoutCountdown: state.showTimeoutCountdown,
    showLineTiming: state.showLineTiming,
    rubyRuntimePreference: state.rubyRuntimePreference,
    firstWorkflowModeSwitchAcknowledged:
      state.firstWorkflowModeSwitchAcknowledged,
    language: state.language,
    lastSeenVersion: state.lastSeenVersion,
    whatsNewNotificationsEnabled: state.whatsNewNotificationsEnabled,
    contextualHintsEnabled: state.contextualHintsEnabled,
    hasCompletedTour: state.hasCompletedTour,
    suppressTourAutoStart: state.suppressTourAutoStart,
    // implementation — sticky onboarding choreography flags so a
    // user who has seen the welcome seed / first-run / first-snippet
    // toasts never sees them again across reloads. Reset toggles
    // in Settings re-arm each stage.
    hasCompletedOnboardingWelcome: state.hasCompletedOnboardingWelcome,
    hasCompletedOnboardingFirstRun: state.hasCompletedOnboardingFirstRun,
    hasCompletedOnboardingFirstSnippet:
      state.hasCompletedOnboardingFirstSnippet,
    onboardingWelcomeSeedVersion: state.onboardingWelcomeSeedVersion,
    shortcutOverrides: state.shortcutOverrides,
    keymapPreset: state.keymapPreset,
    themePack: state.themePack,
    // implementation — persist user-added sensitive header names.
    // Baseline list is never persisted (it's a build-time
    // constant); only the delta the user added.
    sensitiveHttpHeaders: state.sensitiveHttpHeaders,
    // implementation — persist SQL workspace preferences.
    sqlWorkspaceRowDisplayLimit: state.sqlWorkspaceRowDisplayLimit,
    sqlWorkspaceQueryTimeoutMs: state.sqlWorkspaceQueryTimeoutMs,
    // implementation (SQL OPFS) — persist the table-persistence toggle.
    sqlWorkspacePersistTables: state.sqlWorkspacePersistTables,
    // internal — persist the Run Ledger opt-in.
    runLedgerEnabled: state.runLedgerEnabled,
    // implementation Slice C implementation note — persist the user's default language for new
    // notebook code cells; merge sanitizes it back to JS/TS on rehydrate.
    notebookDefaultCellLanguage: state.notebookDefaultCellLanguage,
  };
}

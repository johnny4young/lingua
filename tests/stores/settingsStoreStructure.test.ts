/**
 * RL-129 (AUDIT-09) structure guard — locks the settingsStore split so a future
 * edit cannot silently regress it. Mirrors the RL-128 editorStore guard.
 *
 * - fold C (public API barrel): the assembled store exposes EXACTLY the
 *   `SettingsState` surface (state fields + setters), and `settingsStore.ts`
 *   re-exports EXACTLY `{ useSettingsStore, sanitizeShortcutOverrides }`. Catches
 *   an accidentally-dropped setter during the split AND a new public export
 *   sneaking in.
 * - fold D (size budget): the assembly point stays thin and no extracted module
 *   grows back toward a monolith.
 * - fold E (import acyclicity): no split module imports the store assembly, and
 *   the helper/persistence leaves import neither the store nor an action factory.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as settingsStoreModule from '../../src/renderer/stores/settingsStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

const STORES_DIR = resolve(__dirname, '../../src/renderer/stores');

/** The complete `SettingsState` surface — data fields + setters. */
const EXPECTED_STORE_KEYS = [
  'acknowledgeFirstWorkflowModeSwitch',
  'addSensitiveHttpHeader',
  'applyKeymapPreset',
  'applyThemePack',
  'applyThemePreset',
  'browserPreviewRefreshIntervalMs',
  'capsuleImportClipboardOnFocusConsent',
  'clearShortcutOverride',
  'defaultRuntimeMode',
  'dependencyDetectionEnabled',
  'editorTheme',
  'executionHistorySnapshotEnabled',
  'firstWorkflowModeSwitchAcknowledged',
  'fontFamily',
  'fontSize',
  'formatOnSave',
  'hasCompletedOnboardingFirstRun',
  'hasCompletedOnboardingFirstSnippet',
  'hasCompletedOnboardingWelcome',
  'hasCompletedTour',
  'hintsEnabled',
  'importPreviewClipboardOnFocusConsent',
  'inlineLintEnabledByLanguage',
  'keymapPreset',
  'language',
  'languageScorecardPlatform',
  'lastSeenVersion',
  'layoutPreset',
  'markOnboardingFirstRunCompleted',
  'markOnboardingFirstSnippetCompleted',
  'markOnboardingWelcomeCompleted',
  'maxLoopIterations',
  'minimap',
  'nativeExecutionAcknowledged',
  'nodeRunnerFirstRunNoticeShown',
  'notebookDefaultCellLanguage',
  'onboardingWelcomeSeedVersion',
  'removeSensitiveHttpHeader',
  'resetOnboardingFirstRun',
  'resetOnboardingFirstSnippet',
  'resetOnboardingWelcome',
  'resetShortcutOverrides',
  'restoreSessionMode',
  'rubyRuntimePreference',
  'runLedgerEnabled',
  'runtimeTimeoutPresetByLanguage',
  'scratchpadAutoLogByLanguage',
  'sensitiveHttpHeaders',
  'setCapsuleImportClipboardOnFocusConsent',
  'setDefaultRuntimeMode',
  'setBrowserPreviewRefreshInterval',
  'setEditorTheme',
  'setFontFamily',
  'setFontSize',
  'setHasCompletedTour',
  'setHintsEnabled',
  'setImportPreviewClipboardOnFocusConsent',
  'setInlineLintEnabled',
  'setLanguage',
  'setLanguageScorecardPlatform',
  'setLastSeenVersion',
  'setWhatsNewNotificationsEnabled',
  'setLayoutPreset',
  'setMaxLoopIterations',
  'setNativeExecutionAcknowledged',
  'setNotebookDefaultCellLanguage',
  'setRestoreSessionMode',
  'setRubyRuntimePreference',
  'setRuntimeTimeoutPreset',
  'setScratchpadAutoLogDefault',
  'setShortcutOverride',
  'setShowStatusBar',
  'setSqlWorkspacePersistTables',
  'setRunLedgerEnabled',
  'setSqlWorkspaceQueryTimeoutMs',
  'setSqlWorkspaceRowDisplayLimit',
  'setSuppressTourAutoStart',
  'setTelemetryConsent',
  'setTheme',
  'setUtilitiesClipboardOnFocusConsent',
  'setVariableInspectorSurface',
  'setWorkflowModeDefault',
  'shortcutOverrides',
  'showLineTiming',
  'showStatusBar',
  'showStdinPanel',
  'showTimeoutCountdown',
  'showVariableInspectorByDefault',
  'smartPasteDetectionEnabled',
  'sqlWorkspacePersistTables',
  'sqlWorkspaceQueryTimeoutMs',
  'sqlWorkspaceRowDisplayLimit',
  'suppressTourAutoStart',
  'telemetryConsent',
  'theme',
  'themePack',
  'toggleDependencyDetectionEnabled',
  'toggleExecutionHistorySnapshot',
  'toggleFormatOnSave',
  'toggleMinimap',
  'toggleShowStdinPanel',
  'toggleShowLineTiming',
  'toggleShowTimeoutCountdown',
  'toggleSmartPasteDetection',
  'toggleVimMode',
  'toggleWordWrap',
  'utilitiesClipboardOnFocusConsent',
  'variableInspectorScopeDepth',
  'variableInspectorSurface',
  'vimMode',
  'wordWrap',
  'whatsNewNotificationsEnabled',
  'workflowModeDefaultsByLanguage',
].sort();

/** Symbols `settingsStore.ts` must expose for its existing consumers. */
const EXPECTED_MODULE_EXPORTS = ['useSettingsStore', 'sanitizeShortcutOverrides'].sort();

/** The non-action data fields that must keep their values out of the action set. */
const STATE_FIELDS = new Set([
  'theme',
  'editorTheme',
  'fontSize',
  'fontFamily',
  'wordWrap',
  'minimap',
  'layoutPreset',
  'maxLoopIterations',
  'restoreSessionMode',
  'formatOnSave',
  'smartPasteDetectionEnabled',
  'vimMode',
  'nativeExecutionAcknowledged',
  'executionHistorySnapshotEnabled',
  'telemetryConsent',
  'utilitiesClipboardOnFocusConsent',
  'capsuleImportClipboardOnFocusConsent',
  'importPreviewClipboardOnFocusConsent',
  'dependencyDetectionEnabled',
  'defaultRuntimeMode',
  'workflowModeDefaultsByLanguage',
  'scratchpadAutoLogByLanguage',
  'browserPreviewRefreshIntervalMs',
  'inlineLintEnabledByLanguage',
  'showStdinPanel',
  'showLineTiming',
  'showStatusBar',
  'variableInspectorSurface',
  'runtimeTimeoutPresetByLanguage',
  'showTimeoutCountdown',
  'showVariableInspectorByDefault',
  'variableInspectorScopeDepth',
  'rubyRuntimePreference',
  'runLedgerEnabled',
  'nodeRunnerFirstRunNoticeShown',
  'firstWorkflowModeSwitchAcknowledged',
  'hasCompletedOnboardingWelcome',
  'hasCompletedOnboardingFirstRun',
  'hasCompletedOnboardingFirstSnippet',
  'onboardingWelcomeSeedVersion',
  'language',
  'languageScorecardPlatform',
  'lastSeenVersion',
  'whatsNewNotificationsEnabled',
  'hintsEnabled',
  'hasCompletedTour',
  'suppressTourAutoStart',
  'shortcutOverrides',
  'keymapPreset',
  'themePack',
  'sensitiveHttpHeaders',
  'sqlWorkspaceRowDisplayLimit',
  'sqlWorkspaceQueryTimeoutMs',
  'sqlWorkspacePersistTables',
  'notebookDefaultCellLanguage',
]);

/** The assembly point — must stay thin. */
const ASSEMBLY_FILE = 'settingsStore.ts';
const ASSEMBLY_MAX_LINES = 100;

/** Every extracted settings* module that backs the split. */
const SPLIT_MODULES = [
  'settingsStoreContext.ts',
  'settingsDefaults.ts',
  'settingsSanitizers.ts',
  'settingsPersistence.ts',
  'settingsMerge.ts',
  'settingsAppearanceActions.ts',
  'settingsRuntimeActions.ts',
  'settingsPrivacyActions.ts',
  'settingsSessionActions.ts',
];
const MODULE_MAX_LINES = 300;

/**
 * Leaf modules — must not reach the store OR any action factory, so they stay
 * importable from anywhere without dragging the world (or a cycle) in.
 */
const LEAF_MODULES = [
  'settingsStoreContext.ts',
  'settingsDefaults.ts',
  'settingsSanitizers.ts',
  'settingsPersistence.ts',
  'settingsMerge.ts',
];
const ACTION_FACTORY_MODULES = [
  'settingsAppearanceActions.ts',
  'settingsRuntimeActions.ts',
  'settingsPrivacyActions.ts',
  'settingsSessionActions.ts',
];

function read(file: string): string {
  return readFileSync(resolve(STORES_DIR, file), 'utf8');
}

function lineCount(file: string): number {
  return read(file).split('\n').length;
}

describe('RL-129 settingsStore split — public API barrel (fold C)', () => {
  it('the assembled store exposes exactly the SettingsState surface', () => {
    const keys = Object.keys(useSettingsStore.getState()).sort();
    expect(keys).toEqual(EXPECTED_STORE_KEYS);
  });

  it('every non-state member is a function (no setter dropped to a value)', () => {
    const state = useSettingsStore.getState() as Record<string, unknown>;
    for (const key of EXPECTED_STORE_KEYS) {
      if (STATE_FIELDS.has(key)) continue;
      expect(typeof state[key], `${key} should be a setter function`).toBe('function');
    }
  });

  it('settingsStore.ts re-exports exactly useSettingsStore + sanitizeShortcutOverrides', () => {
    const exported = Object.keys(settingsStoreModule).sort();
    expect(exported).toEqual(EXPECTED_MODULE_EXPORTS);
    expect(typeof settingsStoreModule.sanitizeShortcutOverrides).toBe('function');
  });
});

describe('RL-129 settingsStore split — size budget (fold D)', () => {
  it('the assembly point stays thin', () => {
    expect(lineCount(ASSEMBLY_FILE)).toBeLessThanOrEqual(ASSEMBLY_MAX_LINES);
  });

  it.each(SPLIT_MODULES)('%s stays under the per-module budget', (file) => {
    expect(lineCount(file)).toBeLessThanOrEqual(MODULE_MAX_LINES);
  });
});

describe('RL-129 settingsStore split — import acyclicity (fold E)', () => {
  it.each([...SPLIT_MODULES])('%s does not import the store assembly', (file) => {
    expect(read(file)).not.toMatch(/from\s+['"]\.\/settingsStore['"]/);
  });

  it.each(LEAF_MODULES)('%s is a leaf — no action-factory imports', (file) => {
    const source = read(file);
    for (const factory of ACTION_FACTORY_MODULES) {
      const moduleName = factory.replace(/\.ts$/, '');
      expect(source).not.toMatch(
        new RegExp(`from\\s+['"]\\./${moduleName}['"]`)
      );
    }
  });
});

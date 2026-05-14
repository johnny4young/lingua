import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  KEYBOARD_SHORTCUTS,
  isEditableShortcutCombo,
  type ShortcutCombo,
  type ShortcutOverrideMap,
} from '../data/keyboardShortcuts';
import {
  DEFAULT_KEYMAP_PRESET_ID,
  findKeymapPreset,
  isKnownKeymapPresetId,
} from '../data/keymapPresets';
import {
  DEFAULT_THEME_PACK_ID,
  findThemePack,
  isKnownThemePackId,
  type ThemePackAppearance,
} from '../data/themePacks';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isEntitled } from '../../shared/entitlements';
import type { SettingsState } from '../types';
import {
  isRuntimeModeImplemented,
  type RuntimeMode,
} from '../../shared/runtimeModes';
import {
  isWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../shared/workflowMode';

const DEFAULT_EDITOR_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

/**
 * RL-020 Slice 2 fold C — seeded defaults surfaced in Settings → Editor
 * the first time the user reaches a Slice-2 build. Without this seed,
 * a fresh install (no persisted defaults) would resolve every new tab
 * via the shared `defaultWorkflowMode` helper and the Settings rows
 * would look unset — making the per-language defaults feature
 * invisible.
 *
 * Sparse on purpose: every key here matches the language whose default
 * mode the shared helper already returns. The override is observably
 * a no-op until the user changes it, but the Settings row now shows
 * the chosen value as the active selection rather than "unset".
 */
const WORKFLOW_MODE_DEFAULT_SEED: Record<string, WorkflowMode> = {
  javascript: 'scratchpad',
  typescript: 'scratchpad',
  python: 'scratchpad',
};

const SETTINGS_WORKFLOW_MODE_LANGUAGE_SET: ReadonlySet<string> = new Set(
  Object.keys(WORKFLOW_MODE_DEFAULT_SEED)
);

/**
 * Sanitize a persisted `workflowModeDefaultsByLanguage` map: drop
 * languages outside the Settings surface, drop values that aren't
 * valid `WorkflowMode` strings, drop modes the language does not
 * support. Returns a fresh object so callers can hand it directly to
 * the store without aliasing.
 */
function sanitizeWorkflowModeDefaults(
  value: unknown
): Record<string, WorkflowMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, WorkflowMode> = {};
  for (const [language, rawMode] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!SETTINGS_WORKFLOW_MODE_LANGUAGE_SET.has(language)) continue;
    if (!isWorkflowMode(rawMode)) continue;
    if (!supportsWorkflowMode(language, rawMode)) continue;
    out[language] = rawMode;
  }
  return out;
}

const APP_LANGUAGES = ['system', 'en', 'es'] as const;

function isAppLanguage(value: unknown): value is SettingsState['language'] {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const MAX_TOKENS_PER_COMBO = 5;
const MAX_COMBOS_PER_SHORTCUT = 4;

function shortcutOverridesEqual(
  left: ShortcutOverrideMap,
  right: ShortcutOverrideMap
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const leftKey = leftKeys[index];
    const rightKey = rightKeys[index];
    if (!leftKey || !rightKey) return false;
    if (leftKey !== rightKey) return false;
    const leftCombos = left[leftKey] ?? [];
    const rightCombos = right[rightKey] ?? [];
    if (leftCombos.length !== rightCombos.length) return false;
    for (let comboIndex = 0; comboIndex < leftCombos.length; comboIndex += 1) {
      const leftTokens = leftCombos[comboIndex]?.tokens ?? [];
      const rightTokens = rightCombos[comboIndex]?.tokens ?? [];
      if (leftTokens.length !== rightTokens.length) return false;
      for (let tokenIndex = 0; tokenIndex < leftTokens.length; tokenIndex += 1) {
        if (leftTokens[tokenIndex] !== rightTokens[tokenIndex]) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * RL-089 — exported so the profile-import path can sanitize a
 * crafted profile's `shortcutOverrides` map before writing it to the
 * live store. The persist-middleware merge already runs this on
 * rehydrate; the import path goes around persist and would otherwise
 * leave un-validated overrides live for the rest of the session.
 */
export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrideMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const knownIds = new Set(KEYBOARD_SHORTCUTS.map((entry) => entry.id));
  const out: Record<string, readonly ShortcutCombo[]> = {};
  for (const [key, rawCombos] of Object.entries(value as Record<string, unknown>)) {
    if (!knownIds.has(key)) continue;
    if (!Array.isArray(rawCombos)) continue;
    const combos: ShortcutCombo[] = [];
    for (const raw of rawCombos.slice(0, MAX_COMBOS_PER_SHORTCUT)) {
      if (!raw || typeof raw !== 'object') continue;
      const tokens = (raw as { tokens?: unknown }).tokens;
      if (!Array.isArray(tokens)) continue;
      if (tokens.length === 0 || tokens.length > MAX_TOKENS_PER_COMBO) continue;
      if (!tokens.every((token) => typeof token === 'string' && token.length > 0 && token.length <= 32)) {
        continue;
      }
      const combo = { tokens: tokens as readonly string[] };
      if (!isEditableShortcutCombo(combo)) continue;
      combos.push(combo);
    }
    if (combos.length > 0) out[key] = combos;
  }
  return out;
}

function themePackAppearanceMatchesSettings(
  settings: Pick<
    SettingsState,
    | 'theme'
    | 'editorTheme'
    | 'fontFamily'
    | 'fontSize'
    | 'fontLigatures'
    | 'layoutPreset'
    | 'syncShellWithEditorTheme'
  >,
  appearance: ThemePackAppearance
): boolean {
  return (
    settings.theme === appearance.theme &&
    settings.editorTheme === appearance.editorTheme &&
    settings.fontFamily === appearance.fontFamily &&
    settings.fontSize === appearance.fontSize &&
    settings.fontLigatures === appearance.fontLigatures &&
    settings.layoutPreset === appearance.layoutPreset &&
    settings.syncShellWithEditorTheme === appearance.syncShellWithEditorTheme
  );
}

function syncConsentMirror(
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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      editorTheme: 'lingua-dark',
      fontSize: 14,
      fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
      fontLigatures: true,
      showLineNumbers: true,
      wordWrap: false,
      minimap: false,
      layoutPreset: 'horizontal',
      loopProtection: true,
      maxLoopIterations: 10_000,
      hideUndefined: true,
      restoreSession: false,
      formatOnSave: false,
      vimMode: false,
      nativeExecutionAcknowledged: false,
      syncShellWithEditorTheme: true,
      executionHistorySnapshotEnabled: true,
      telemetryConsent: 'unset',
      utilitiesClipboardOnFocusConsent: 'unset',
      debuggerEnabled: true,
      // RL-019 Slice 1 fold B — only `worker` is implemented today;
      // the setter rejects anything else, so this stays a constant
      // initial value until Slice 2 lands the desktop Node backend.
      defaultRuntimeMode: 'worker',
      // RL-020 Slice 2 — per-language workflow defaults. Initial
      // value is the fold-C seed; the merge function below preserves
      // user overrides on rehydrate and seeds missing keys.
      workflowModeDefaultsByLanguage: { ...WORKFLOW_MODE_DEFAULT_SEED },
      // RL-020 Slice 2 fold F — onboarding-toast acknowledgement.
      firstWorkflowModeSwitchAcknowledged: false,
      language: 'system',
      lastSeenVersion: null,
      hasCompletedTour: false,
      suppressTourAutoStart: false,
      shortcutOverrides: {},
      keymapPreset: DEFAULT_KEYMAP_PRESET_ID,
      themePack: DEFAULT_THEME_PACK_ID,

      // Each field the theme pack covers resets `themePack` to `default` so
      // the selector never lies about the active pack. Line numbers, word
      // wrap, and minimap aren't part of the pack so they stay untouched.
      setTheme: (theme) =>
        set({
          theme,
          themePack: DEFAULT_THEME_PACK_ID,
          // Explicit shell-polarity choice wins over sync. Without this, a
          // click on Dark/Light would be silently overridden whenever the
          // editor theme's polarity differs from the chosen shell.
          syncShellWithEditorTheme: false,
        }),
      setEditorTheme: (editorTheme) =>
        set({ editorTheme, themePack: DEFAULT_THEME_PACK_ID }),
      setFontSize: (fontSize) => set({ fontSize, themePack: DEFAULT_THEME_PACK_ID }),
      setFontFamily: (fontFamily) =>
        set((state) => {
          if (
            fontFamily !== DEFAULT_EDITOR_FONT_FAMILY &&
            !isEntitled(currentEffectiveTier(), 'FONT_PACK_EXTENDED')
          ) {
            return state;
          }
          return { fontFamily, themePack: DEFAULT_THEME_PACK_ID };
        }),
      toggleFontLigatures: () =>
        set((s) => ({
          fontLigatures: !s.fontLigatures,
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
      setLayoutPreset: (layoutPreset) =>
        set({ layoutPreset, themePack: DEFAULT_THEME_PACK_ID }),
      toggleLoopProtection: () => set((s) => ({ loopProtection: !s.loopProtection })),
      setMaxLoopIterations: (maxLoopIterations) => set({ maxLoopIterations }),
      toggleHideUndefined: () => set((s) => ({ hideUndefined: !s.hideUndefined })),
      toggleRestoreSession: () => set((s) => ({ restoreSession: !s.restoreSession })),
      toggleFormatOnSave: () => set((s) => ({ formatOnSave: !s.formatOnSave })),
      toggleVimMode: () => set((s) => ({ vimMode: !s.vimMode })),
      setNativeExecutionAcknowledged: (nativeExecutionAcknowledged) =>
        set({ nativeExecutionAcknowledged }),
      toggleSyncShellWithEditorTheme: () =>
        set((s) => ({
          syncShellWithEditorTheme: !s.syncShellWithEditorTheme,
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      toggleExecutionHistorySnapshot: () =>
        set((s) => ({ executionHistorySnapshotEnabled: !s.executionHistorySnapshotEnabled })),
      setTelemetryConsent: (telemetryConsent) => {
        set({ telemetryConsent });
        // Mirror to main so `bootCrashReporter` can read consent at the
        // next app boot, before createWindow().
        syncConsentMirror(telemetryConsent);
      },
      // RL-069 Slice 3 — clipboard-on-focus consent. Local-only; no
      // mirror to main because the feature is renderer-scoped.
      setUtilitiesClipboardOnFocusConsent: (utilitiesClipboardOnFocusConsent) => {
        set({ utilitiesClipboardOnFocusConsent });
      },
      // RL-027 Slice 1 — debugger master switch.
      toggleDebuggerEnabled: () =>
        set((state) => ({ debuggerEnabled: !state.debuggerEnabled })),
      applyThemePreset: (preset) =>
        set((state) => ({
          theme: preset.theme,
          editorTheme: preset.editorTheme,
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontLigatures: preset.fontLigatures,
          layoutPreset: preset.layoutPreset,
          syncShellWithEditorTheme:
            preset.syncShellWithEditorTheme ?? state.syncShellWithEditorTheme,
          // Imported presets are user-authored; the built-in pack selector
          // should reset to default so it doesn't claim a bundle is in force.
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      setLanguage: (language) => set({ language }),
      // RL-019 Slice 1 fold B — guard the setter so only implemented
      // modes can be persisted as the per-app default. Unimplemented
      // modes (`node`, `browser-preview` in Slice 1) are silently
      // rejected; the selector renders them disabled so this branch
      // is only reachable from programmatic / palette / shortcut
      // entry points.
      setDefaultRuntimeMode: (mode: RuntimeMode) => {
        if (!isRuntimeModeImplemented(mode)) return;
        set({ defaultRuntimeMode: mode });
      },
      // RL-020 Slice 2 — set or clear the per-language workflow
      // default. `null` resets to the shared helper. The setter
      // refuses any mode the language does not support so the
      // Settings UI cannot smuggle an invalid combination through
      // a programmatic call.
      setWorkflowModeDefault: (language: string, mode: WorkflowMode | null) => {
        if (!SETTINGS_WORKFLOW_MODE_LANGUAGE_SET.has(language)) return;
        set((state) => {
          const next = { ...state.workflowModeDefaultsByLanguage };
          if (mode === null) {
            delete next[language];
          } else {
            if (!isWorkflowMode(mode)) return state;
            if (!supportsWorkflowMode(language, mode)) return state;
            next[language] = mode;
          }
          return { workflowModeDefaultsByLanguage: next };
        });
      },
      // RL-020 Slice 2 fold F — record that the onboarding toast has
      // been seen so future workflow-mode switches stay silent.
      acknowledgeFirstWorkflowModeSwitch: () =>
        set({ firstWorkflowModeSwitchAcknowledged: true }),
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
      setHasCompletedTour: (hasCompletedTour) => set({ hasCompletedTour }),
      setSuppressTourAutoStart: (suppressTourAutoStart) => set({ suppressTourAutoStart }),
      setShortcutOverride: (id, combos) =>
        set((state) => ({
          shortcutOverrides: { ...state.shortcutOverrides, [id]: combos },
          // Any manual edit peels the user out of a preset; the UI should
          // honestly show "Custom" (== default id with non-empty overrides)
          // so they don't think the preset is still in force.
          keymapPreset: DEFAULT_KEYMAP_PRESET_ID,
        })),
      clearShortcutOverride: (id) =>
        set((state) => {
          if (!(id in state.shortcutOverrides)) return state;
          const next = { ...state.shortcutOverrides };
          delete next[id];
          return {
            shortcutOverrides: next,
            keymapPreset: DEFAULT_KEYMAP_PRESET_ID,
          };
        }),
      resetShortcutOverrides: () =>
        set({ shortcutOverrides: {}, keymapPreset: DEFAULT_KEYMAP_PRESET_ID }),
      applyKeymapPreset: (presetId) => {
        const preset = findKeymapPreset(presetId);
        if (!preset) return;
        set({
          keymapPreset: preset.id,
          // Clone so callers can't mutate the canonical preset map by
          // editing the store value afterwards.
          shortcutOverrides: { ...preset.overrides },
        });
      },
      applyThemePack: (packId) => {
        const pack = findThemePack(packId);
        if (!pack) return;
        if (
          pack.id !== DEFAULT_THEME_PACK_ID &&
          !isEntitled(currentEffectiveTier(), 'THEME_PACK_EXTENDED')
        ) {
          return;
        }
        set({
          themePack: pack.id,
          theme: pack.appearance.theme,
          editorTheme: pack.appearance.editorTheme,
          fontFamily: pack.appearance.fontFamily,
          fontSize: pack.appearance.fontSize,
          fontLigatures: pack.appearance.fontLigatures,
          layoutPreset: pack.appearance.layoutPreset,
          syncShellWithEditorTheme: pack.appearance.syncShellWithEditorTheme,
        });
      },
    }),
    {
      name: 'lingua-settings',
      // Omit functions from persistence
      partialize: (state) => ({
        theme: state.theme,
        editorTheme: state.editorTheme,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        fontLigatures: state.fontLigatures,
        showLineNumbers: state.showLineNumbers,
        wordWrap: state.wordWrap,
        minimap: state.minimap,
        layoutPreset: state.layoutPreset,
        loopProtection: state.loopProtection,
        maxLoopIterations: state.maxLoopIterations,
        hideUndefined: state.hideUndefined,
        restoreSession: state.restoreSession,
        formatOnSave: state.formatOnSave,
        vimMode: state.vimMode,
        nativeExecutionAcknowledged: state.nativeExecutionAcknowledged,
        syncShellWithEditorTheme: state.syncShellWithEditorTheme,
        executionHistorySnapshotEnabled: state.executionHistorySnapshotEnabled,
        telemetryConsent: state.telemetryConsent,
        utilitiesClipboardOnFocusConsent: state.utilitiesClipboardOnFocusConsent,
        debuggerEnabled: state.debuggerEnabled,
        defaultRuntimeMode: state.defaultRuntimeMode,
        workflowModeDefaultsByLanguage: state.workflowModeDefaultsByLanguage,
        firstWorkflowModeSwitchAcknowledged:
          state.firstWorkflowModeSwitchAcknowledged,
        language: state.language,
        lastSeenVersion: state.lastSeenVersion,
        hasCompletedTour: state.hasCompletedTour,
        suppressTourAutoStart: state.suppressTourAutoStart,
        shortcutOverrides: state.shortcutOverrides,
        keymapPreset: state.keymapPreset,
        themePack: state.themePack,
      }),
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === 'object'
            ? (persistedState as Partial<SettingsState>)
            : undefined;
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
        const normalizedThemePack =
          requestedThemePack === DEFAULT_THEME_PACK_ID
            ? DEFAULT_THEME_PACK_ID
            : themePackAppearanceMatchesSettings(
                  {
                    theme: merged.theme,
                    editorTheme: merged.editorTheme,
                    fontFamily: merged.fontFamily,
                    fontSize: merged.fontSize,
                    fontLigatures: merged.fontLigatures,
                    layoutPreset: merged.layoutPreset,
                    syncShellWithEditorTheme: merged.syncShellWithEditorTheme,
                  },
                  findThemePack(requestedThemePack)?.appearance ?? {
                    theme: currentState.theme,
                    editorTheme: currentState.editorTheme,
                    fontFamily: currentState.fontFamily,
                    fontSize: currentState.fontSize,
                    fontLigatures: currentState.fontLigatures,
                    layoutPreset: currentState.layoutPreset,
                    syncShellWithEditorTheme: currentState.syncShellWithEditorTheme,
                  }
                )
              ? requestedThemePack
              : DEFAULT_THEME_PACK_ID;

        // RL-019 Slice 1 — guard `defaultRuntimeMode` on rehydrate
        // the same way `setDefaultRuntimeMode` does at runtime. A
        // tampered localStorage entry with an unimplemented or
        // unknown string would otherwise survive into the live
        // store and surface a broken Select in Settings.
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
        const firstWorkflowModeSwitchAcknowledged =
          typeof merged.firstWorkflowModeSwitchAcknowledged === 'boolean'
            ? merged.firstWorkflowModeSwitchAcknowledged
            : currentState.firstWorkflowModeSwitchAcknowledged;
        return {
          ...merged,
          language: isAppLanguage(merged.language) ? merged.language : currentState.language,
          executionHistorySnapshotEnabled,
          nativeExecutionAcknowledged,
          shortcutOverrides,
          keymapPreset: normalizedKeymapPreset,
          themePack: normalizedThemePack,
          defaultRuntimeMode: normalizedDefaultRuntimeMode,
          workflowModeDefaultsByLanguage: seededWorkflowDefaults,
          firstWorkflowModeSwitchAcknowledged,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }
        // Seed/refresh the main-process mirror after every startup
        // rehydrate so pre-existing opt-ins survive the upgrade to the
        // RL-067 mirror path without forcing the user to toggle again.
        syncConsentMirror(state.telemetryConsent);
      },
    }
  )
);

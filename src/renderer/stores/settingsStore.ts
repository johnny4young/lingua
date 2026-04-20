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
import type { SettingsState } from '../types';

const APP_LANGUAGES = ['system', 'en', 'es'] as const;

function isAppLanguage(value: unknown): value is SettingsState['language'] {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
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

function sanitizeShortcutOverrides(value: unknown): ShortcutOverrideMap {
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
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
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
      syncShellWithEditorTheme: true,
      telemetryConsent: 'unset',
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
        set({ fontFamily, themePack: DEFAULT_THEME_PACK_ID }),
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
      toggleSyncShellWithEditorTheme: () =>
        set((s) => ({
          syncShellWithEditorTheme: !s.syncShellWithEditorTheme,
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      setTelemetryConsent: (telemetryConsent) => {
        set({ telemetryConsent });
        // Mirror to main so `bootCrashReporter` can read consent at the
        // next app boot, before createWindow().
        syncConsentMirror(telemetryConsent);
      },
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
        syncShellWithEditorTheme: state.syncShellWithEditorTheme,
        telemetryConsent: state.telemetryConsent,
        language: state.language,
        lastSeenVersion: state.lastSeenVersion,
        hasCompletedTour: state.hasCompletedTour,
        suppressTourAutoStart: state.suppressTourAutoStart,
        shortcutOverrides: state.shortcutOverrides,
        keymapPreset: state.keymapPreset,
        themePack: state.themePack,
      }),
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<SettingsState> | undefined),
        };
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

        return {
          ...merged,
          language: isAppLanguage(merged.language) ? merged.language : currentState.language,
          shortcutOverrides,
          keymapPreset: normalizedKeymapPreset,
          themePack: normalizedThemePack,
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

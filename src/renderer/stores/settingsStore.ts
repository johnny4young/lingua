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
      language: 'system',
      lastSeenVersion: null,
      hasCompletedTour: false,
      suppressTourAutoStart: false,
      shortcutOverrides: {},
      keymapPreset: DEFAULT_KEYMAP_PRESET_ID,

      setTheme: (theme) => set({ theme }),
      setEditorTheme: (editorTheme) => set({ editorTheme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      toggleFontLigatures: () => set((s) => ({ fontLigatures: !s.fontLigatures })),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
      setLayoutPreset: (layoutPreset) => set({ layoutPreset }),
      toggleLoopProtection: () => set((s) => ({ loopProtection: !s.loopProtection })),
      setMaxLoopIterations: (maxLoopIterations) => set({ maxLoopIterations }),
      toggleHideUndefined: () => set((s) => ({ hideUndefined: !s.hideUndefined })),
      toggleRestoreSession: () => set((s) => ({ restoreSession: !s.restoreSession })),
      toggleFormatOnSave: () => set((s) => ({ formatOnSave: !s.formatOnSave })),
      toggleSyncShellWithEditorTheme: () =>
        set((s) => ({ syncShellWithEditorTheme: !s.syncShellWithEditorTheme })),
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
        language: state.language,
        lastSeenVersion: state.lastSeenVersion,
        hasCompletedTour: state.hasCompletedTour,
        suppressTourAutoStart: state.suppressTourAutoStart,
        shortcutOverrides: state.shortcutOverrides,
        keymapPreset: state.keymapPreset,
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

        return {
          ...merged,
          language: isAppLanguage(merged.language) ? merged.language : currentState.language,
          shortcutOverrides,
          keymapPreset: normalizedKeymapPreset,
        };
      },
    }
  )
);

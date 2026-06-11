import type { SettingsState } from '../types';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isEntitled } from '../../shared/entitlements';
import { isDarkEditorTheme } from '../components/Settings/settingsOptions';
import { DEFAULT_KEYMAP_PRESET_ID, findKeymapPreset } from '../data/keymapPresets';
import { DEFAULT_THEME_PACK_ID, findThemePack } from '../data/themePacks';
import { DEFAULT_EDITOR_FONT_FAMILY } from './settingsDefaults';
import type { SettingsSet } from './settingsStoreContext';

/**
 * RL-129 fold B — appearance setter factory for the settings store. Bundles the
 * theme / editor-theme / font / layout / vim / word-wrap / minimap setters plus
 * the theme-pack, theme-preset, and keymap-preset/shortcut-override appliers.
 * Extracted verbatim from `settingsStore.ts`. Each appearance write that the
 * theme pack covers resets `themePack` to `default` so the selector never lies
 * about the active pack. `set`-only — none of these setters read `get()`.
 */
export function createAppearanceActions(
  set: SettingsSet
): Pick<
  SettingsState,
  | 'setTheme'
  | 'setEditorTheme'
  | 'setFontSize'
  | 'setFontFamily'
  | 'toggleWordWrap'
  | 'toggleMinimap'
  | 'setLayoutPreset'
  | 'toggleVimMode'
  | 'applyThemePreset'
  | 'applyKeymapPreset'
  | 'applyThemePack'
  | 'setShortcutOverride'
  | 'clearShortcutOverride'
  | 'resetShortcutOverrides'
> {
  return {
    // Each field the theme pack covers resets `themePack` to `default` so
    // the selector never lies about the active pack. Line numbers, word
    // wrap, and minimap aren't part of the pack so they stay untouched.
    setTheme: (theme) =>
      set({
        theme,
        editorTheme: theme === 'light' ? 'lingua-light' : 'lingua-dark',
        themePack: DEFAULT_THEME_PACK_ID,
      }),
    setEditorTheme: (editorTheme) =>
      set({
        editorTheme,
        // state.theme must stay a faithful mirror of the effective shell
        // polarity (which derives from editorTheme — see
        // resolveEffectiveShellTheme): the inline boot scripts in
        // index.html / src/web/index.html fall back to state.theme for
        // legacy persisted states, profileExport.ts embeds it, and
        // settingsMerge compares it against theme-pack appearances. The
        // runtime shell ignores state.theme, so this changes no visible
        // behavior — it only keeps the persisted field honest.
        theme: isDarkEditorTheme(editorTheme) ? 'dark' : 'light',
        themePack: DEFAULT_THEME_PACK_ID,
      }),
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
    toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
    toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
    setLayoutPreset: (layoutPreset) =>
      set({ layoutPreset, themePack: DEFAULT_THEME_PACK_ID }),
    toggleVimMode: () => set((s) => ({ vimMode: !s.vimMode })),
    applyThemePreset: (preset) =>
      set(() => ({
        theme: preset.theme,
        editorTheme: preset.editorTheme,
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        layoutPreset: preset.layoutPreset,
        // Imported presets are user-authored; the built-in pack selector
        // should reset to default so it doesn't claim a bundle is in force.
        themePack: DEFAULT_THEME_PACK_ID,
      })),
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
        layoutPreset: pack.appearance.layoutPreset,
      });
    },
  };
}

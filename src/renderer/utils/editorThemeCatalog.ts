/**
 * Editor theme catalog — the canonical list of Monaco theme ids this build
 * renders, plus the dark/light classifier derived from it.
 *
 * Lives in `utils/` (not `components/Settings/`) because stores and hooks
 * consume it too: `settingsAppearanceActions` (a store) classifying a theme
 * as dark must not import from the components layer — the import direction
 * is stores → utils/shared only, enforced by `no-restricted-imports` in
 * eslint.config.mjs. `components/Settings/settingsOptions.ts` re-exports
 * everything here so component-side call sites keep their import path.
 */

export interface EditorThemeOption {
  id: string;
  label: string;
  dark: boolean;
}

export const EDITOR_THEMES: readonly EditorThemeOption[] = [
  { id: 'lingua-dark', label: 'Lingua Dark', dark: true },
  { id: 'lingua-light', label: 'Lingua Light', dark: false },
  { id: 'dracula', label: 'Dracula', dark: true },
  { id: 'one-dark-pro', label: 'One Dark Pro', dark: true },
  { id: 'monokai', label: 'Monokai', dark: true },
  { id: 'nord-night', label: 'Nord Night', dark: true },
  { id: 'vs-dark', label: 'VS Dark', dark: true },
  { id: 'vs', label: 'VS Light', dark: false },
  { id: 'solarized-light', label: 'Solarized Light', dark: false },
  { id: 'hc-black', label: 'High Contrast Dark', dark: true },
];

/**
 * Canonical list of Monaco editor theme ids this build knows how to render.
 * Consumers that need to validate untrusted input (imported presets, URL
 * params) should reference this rather than hard-coding a parallel array.
 */
export const EDITOR_THEME_IDS: readonly string[] = EDITOR_THEMES.map((entry) => entry.id);

/** Whether a given theme id maps to a dark Monaco theme. Unknown ids fall back to dark. */
export function isDarkEditorTheme(themeId: string): boolean {
  const match = EDITOR_THEMES.find((entry) => entry.id === themeId);
  return match ? match.dark : true;
}

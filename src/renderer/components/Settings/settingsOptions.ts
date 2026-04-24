import type { LayoutPreset } from '../../types';

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

export interface FontFamilyOption {
  value: string;
  label: string;
  /** Whether this font stack includes at least one programmer ligature font. */
  supportsLigatures: boolean;
}

export const FONT_FAMILIES: FontFamilyOption[] = [
  {
    value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    label: 'JetBrains Mono',
    supportsLigatures: true,
  },
  { value: "'Fira Code', monospace", label: 'Fira Code', supportsLigatures: true },
  { value: "'Cascadia Code', monospace", label: 'Cascadia Code', supportsLigatures: true },
  { value: "'Source Code Pro', monospace", label: 'Source Code Pro', supportsLigatures: false },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono', supportsLigatures: false },
  { value: 'Consolas, monospace', label: 'Consolas', supportsLigatures: false },
  { value: 'Menlo, monospace', label: 'Menlo', supportsLigatures: false },
  { value: 'Monaco, monospace', label: 'Monaco', supportsLigatures: false },
  { value: "'Courier New', monospace", label: 'Courier New', supportsLigatures: false },
  { value: 'monospace', label: 'System Monospace', supportsLigatures: false },
];

export const DEFAULT_FONT_FAMILY = FONT_FAMILIES[0]?.value ?? 'monospace';

/**
 * Return true if the font stack is known to carry ligature glyphs. Falls back
 * to true for unknown custom stacks so we never silently disable ligatures for
 * a user-supplied font that might have them.
 */
export function fontStackSupportsLigatures(fontFamily: string): boolean {
  const match = FONT_FAMILIES.find((entry) => entry.value === fontFamily);
  return match ? match.supportsLigatures : true;
}

export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20, 24];

export const LAYOUT_PRESETS: {
  id: LayoutPreset;
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    id: 'horizontal',
    labelKey: 'layout.preset.horizontal.label',
    descriptionKey: 'layout.preset.horizontal.description',
  },
  {
    id: 'vertical',
    labelKey: 'layout.preset.vertical.label',
    descriptionKey: 'layout.preset.vertical.description',
  },
  {
    id: 'editor-only',
    labelKey: 'layout.preset.editorOnly.label',
    descriptionKey: 'layout.preset.editorOnly.description',
  },
];

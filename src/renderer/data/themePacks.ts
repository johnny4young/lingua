import type { LayoutPreset, SettingsState } from '../types/settings';

/**
 * Curated theme packs that ship with the application. A pack is a
 * coherent appearance bundle the user can apply with one click — it
 * sets every visual setting that contributes to the editor + shell
 * "look" so a pack-applied state never reads as half-themed.
 *
 * Packs are intentionally curated and bundled; user-imported presets
 * follow a separate flow (`utils/themePreset.ts`). An earlier change trimmed
 * `fontLigatures` + `syncShellWithEditorTheme` from the pack schema —
 * ligatures auto-detect from the font stack, and shell polarity
 * always follows the editor theme.
 */
export interface ThemePackAppearance {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontFamily: string;
  fontSize: number;
  layoutPreset: LayoutPreset;
}

export interface ThemePack {
  id: string;
  labelKey: string;
  descriptionKey: string;
  appearance: ThemePackAppearance;
  /** Free on every tier; the rest need the extended theme-pack entitlement. */
  free?: boolean;
}

/** Also the "no pack in force" marker that manual appearance edits fall back to. */
export const DEFAULT_THEME_PACK_ID = 'default';
export const INK_THEME_PACK_ID = 'lingua-ink';
export const PAPER_THEME_PACK_ID = 'lingua-paper';

/** Lingua's identity editor face: Recursive with its MONO axis on (see utils/editorFontVariations.ts). */
export const RECURSIVE_MONO_FONT_FAMILY = "'Recursive', 'JetBrains Mono', ui-monospace, monospace";
export const CLASSIC_EDITOR_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

/** Editor faces every tier may pick; the rest need the extended font entitlement. */
export function isFreeEditorFontFamily(fontFamily: string): boolean {
  return fontFamily === CLASSIC_EDITOR_FONT_FAMILY || fontFamily === RECURSIVE_MONO_FONT_FAMILY;
}

export const THEME_PACKS: readonly ThemePack[] = [
  {
    id: INK_THEME_PACK_ID,
    labelKey: 'settings.themePack.ink.label',
    descriptionKey: 'settings.themePack.ink.description',
    free: true,
    appearance: {
      theme: 'dark',
      editorTheme: 'lingua-ink',
      fontFamily: RECURSIVE_MONO_FONT_FAMILY,
      fontSize: 14,
      layoutPreset: 'horizontal',
    },
  },
  {
    id: PAPER_THEME_PACK_ID,
    labelKey: 'settings.themePack.paper.label',
    descriptionKey: 'settings.themePack.paper.description',
    free: true,
    appearance: {
      theme: 'light',
      editorTheme: 'lingua-paper',
      fontFamily: RECURSIVE_MONO_FONT_FAMILY,
      fontSize: 14,
      layoutPreset: 'horizontal',
    },
  },
  {
    id: DEFAULT_THEME_PACK_ID,
    labelKey: 'settings.themePack.default.label',
    descriptionKey: 'settings.themePack.default.description',
    free: true,
    appearance: {
      theme: 'dark',
      editorTheme: 'lingua-dark',
      fontFamily: CLASSIC_EDITOR_FONT_FAMILY,
      fontSize: 14,
      layoutPreset: 'horizontal',
    },
  },
  {
    id: 'solarized-daylight',
    labelKey: 'settings.themePack.solarizedDaylight.label',
    descriptionKey: 'settings.themePack.solarizedDaylight.description',
    appearance: {
      theme: 'light',
      editorTheme: 'solarized-light',
      fontFamily: 'Menlo, monospace',
      fontSize: 14,
      layoutPreset: 'horizontal',
    },
  },
  {
    id: 'nord-night',
    labelKey: 'settings.themePack.nordNight.label',
    descriptionKey: 'settings.themePack.nordNight.description',
    appearance: {
      theme: 'dark',
      editorTheme: 'nord-night',
      fontFamily: "'Fira Code', monospace",
      fontSize: 14,
      layoutPreset: 'horizontal',
    },
  },
];

export function findThemePack(id: string): ThemePack | undefined {
  return THEME_PACKS.find((pack) => pack.id === id);
}

export function isKnownThemePackId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0) return false;
  return THEME_PACKS.some((pack) => pack.id === id);
}

export function isFreeThemePack(id: string): boolean {
  return findThemePack(id)?.free === true;
}

/**
 * Theme-pack normalization mirror for appearance fields. A selected pack is
 * considered active only if every pack-owned setting still equals the catalog
 * bundle; manual edits to theme, editor theme, font, size, or layout clear the
 * pack marker so Settings never shows a stale active preset.
 */
export function themePackAppearanceMatchesSettings(
  settings: Pick<SettingsState, 'theme' | 'editorTheme' | 'fontFamily' | 'fontSize' | 'layoutPreset'>,
  appearance: ThemePackAppearance
): boolean {
  return (
    settings.theme === appearance.theme &&
    settings.editorTheme === appearance.editorTheme &&
    settings.fontFamily === appearance.fontFamily &&
    settings.fontSize === appearance.fontSize &&
    settings.layoutPreset === appearance.layoutPreset
  );
}

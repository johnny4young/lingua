import type { LayoutPreset } from '../types';

/**
 * Curated theme packs that ship with the application. A pack is a
 * coherent appearance bundle the user can apply with one click — it
 * sets every visual setting that contributes to the editor + shell
 * "look" so a pack-applied state never reads as half-themed.
 *
 * Packs are intentionally curated and bundled; user-imported presets
 * follow a separate flow (`utils/themePreset.ts`). Slice 2 trimmed
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
}

export const DEFAULT_THEME_PACK_ID = 'default';

export const THEME_PACKS: readonly ThemePack[] = [
  {
    id: DEFAULT_THEME_PACK_ID,
    labelKey: 'settings.themePack.default.label',
    descriptionKey: 'settings.themePack.default.description',
    appearance: {
      theme: 'dark',
      editorTheme: 'lingua-dark',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
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

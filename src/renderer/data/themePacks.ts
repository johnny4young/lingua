import type { LayoutPreset } from '../types';

/**
 * A theme pack is a built-in, named bundle of appearance + typography +
 * layout settings that users can apply from a single dropdown. It reuses
 * the same shape as exported theme presets so the import/export path and
 * the built-in selector stay on one code path.
 *
 * Unlike exported presets, theme packs ship in the renderer bundle so
 * they need to stay small and tasteful. Only add a pack when it feels
 * meaningfully distinct from the existing ones — otherwise the dropdown
 * becomes noise.
 */
export interface ThemePackAppearance {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  layoutPreset: LayoutPreset;
  syncShellWithEditorTheme: boolean;
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
      fontLigatures: true,
      layoutPreset: 'horizontal',
      syncShellWithEditorTheme: true,
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
      fontLigatures: false,
      layoutPreset: 'horizontal',
      syncShellWithEditorTheme: true,
    },
  },
];

export function findThemePack(id: string): ThemePack | undefined {
  return THEME_PACKS.find((pack) => pack.id === id);
}

export function isKnownThemePackId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return THEME_PACKS.some((pack) => pack.id === id);
}

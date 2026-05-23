import type { LayoutPreset, SettingsState } from '../types';

export const THEME_PRESET_VERSION = 2;

/**
 * Known schema versions this build can parse. Writing always targets
 * `THEME_PRESET_VERSION`; reading accepts any version in this set and fills
 * in defaults for fields added after the original shape shipped.
 */
const SUPPORTED_PRESET_VERSIONS: readonly number[] = [1, 2];

export type ThemePresetParseFailure =
  | 'invalid-json'
  | 'invalid-shape'
  | 'unsupported-version';

export interface ThemePreset {
  version: number;
  appearance: {
    theme: SettingsState['theme'];
    editorTheme: string;
    /**
     * Added in v2. When importing a v1 preset we inject `true` so existing
     * exports keep the new default behavior without users noticing drift.
     */
    syncShellWithEditorTheme: boolean;
  };
  typography: {
    fontFamily: string;
    fontSize: number;
    fontLigatures: boolean;
  };
  layout: {
    layoutPreset: LayoutPreset;
  };
}

export interface ThemePresetInputs {
  theme: SettingsState['theme'];
  editorTheme: SettingsState['editorTheme'];
  fontFamily: SettingsState['fontFamily'];
  fontSize: SettingsState['fontSize'];
  layoutPreset: SettingsState['layoutPreset'];
  // Slice 2 — preserved fields for backward compatibility with older
  // exports. Always `true` on a Slice 2+ build; older builds keep their
  // persisted value when round-tripping a preset.
  fontLigatures: boolean;
  syncShellWithEditorTheme: boolean;
}

const LAYOUT_PRESETS: readonly LayoutPreset[] = ['horizontal', 'vertical', 'editor-only'];
const APPEARANCE_THEMES: readonly SettingsState['theme'][] = ['dark', 'light'];
const EDITOR_THEMES = [
  'lingua-dark',
  'lingua-light',
  'dracula',
  'one-dark-pro',
  'monokai',
  'nord-night',
  'vs-dark',
  'vs',
  'solarized-light',
  'hc-black',
] as const;

/** Snapshot the theming-related subset of settings into the preset schema. */
export function buildThemePreset(input: ThemePresetInputs): ThemePreset {
  return {
    version: THEME_PRESET_VERSION,
    appearance: {
      theme: input.theme,
      editorTheme: input.editorTheme,
      syncShellWithEditorTheme: input.syncShellWithEditorTheme,
    },
    typography: {
      fontFamily: input.fontFamily,
      fontSize: input.fontSize,
      fontLigatures: input.fontLigatures,
    },
    layout: {
      layoutPreset: input.layoutPreset,
    },
  };
}

/**
 * Serialize a preset with stable 2-space indentation so exports diff cleanly
 * and remain human-editable when shared between teams.
 */
export function serializeThemePreset(preset: ThemePreset): string {
  return JSON.stringify(preset, null, 2) + '\n';
}

export type ParseThemePresetResult =
  | { ok: true; preset: ThemePreset }
  | { ok: false; reason: ThemePresetParseFailure; message?: string };

function isLayoutPreset(value: unknown): value is LayoutPreset {
  return typeof value === 'string' && (LAYOUT_PRESETS as readonly string[]).includes(value);
}

function isAppearanceTheme(value: unknown): value is SettingsState['theme'] {
  return typeof value === 'string' && (APPEARANCE_THEMES as readonly string[]).includes(value);
}

function isEditorTheme(value: unknown): value is string {
  return typeof value === 'string' && (EDITOR_THEMES as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

/**
 * Parse a raw string produced by an export (or hand-authored preset) back into
 * a validated preset. Never throws — failures come back as a discriminated
 * result so the caller can surface them via the shared status-notice pipeline.
 */
export function parseThemePreset(raw: string): ParseThemePresetResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    return { ok: false, reason: 'invalid-json', message };
  }

  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'invalid-shape' };
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.version !== 'number' ||
    !SUPPORTED_PRESET_VERSIONS.includes(candidate.version)
  ) {
    return {
      ok: false,
      reason: 'unsupported-version',
      message:
        typeof candidate.version === 'number'
          ? `Got version ${candidate.version}`
          : 'Missing version field',
    };
  }

  const appearance = candidate.appearance as Record<string, unknown> | undefined;
  const typography = candidate.typography as Record<string, unknown> | undefined;
  const layout = candidate.layout as Record<string, unknown> | undefined;

  if (!appearance || !typography || !layout) {
    return { ok: false, reason: 'invalid-shape' };
  }

  if (
    !isAppearanceTheme(appearance.theme) ||
    !isEditorTheme(appearance.editorTheme) ||
    !isNonEmptyString(typography.fontFamily) ||
    !isFiniteInteger(typography.fontSize) ||
    typeof typography.fontLigatures !== 'boolean' ||
    !isLayoutPreset(layout.layoutPreset)
  ) {
    return { ok: false, reason: 'invalid-shape' };
  }

  // `syncShellWithEditorTheme` was added in v2. v1 exports predate the
  // setting entirely; defaulting to `true` matches the runtime default so
  // a re-imported legacy preset behaves identically to a brand-new install.
  const syncShellWithEditorTheme =
    typeof appearance.syncShellWithEditorTheme === 'boolean'
      ? appearance.syncShellWithEditorTheme
      : true;

  return {
    ok: true,
    preset: {
      version: THEME_PRESET_VERSION,
      appearance: {
        theme: appearance.theme,
        editorTheme: appearance.editorTheme,
        syncShellWithEditorTheme,
      },
      typography: {
        fontFamily: typography.fontFamily,
        fontSize: typography.fontSize,
        fontLigatures: typography.fontLigatures,
      },
      layout: {
        layoutPreset: layout.layoutPreset,
      },
    },
  };
}

/**
 * RL-089 — versioned user-profile backup format.
 *
 * Pure module. No Node, no React, no Electron — so the renderer
 * imports it without dragging unwanted globals into its bundle and
 * tests can build / parse fixtures without spinning up either runtime.
 *
 * The schema is an ALLOWLIST. Every portable field is listed
 * explicitly so a future settings field doesn't silently leak into
 * exports. Fields documented as machine-bound (license tokens,
 * device IDs, telemetry consent, recent files / sessions, plugin
 * discovery state, transient UI state) are NEVER part of the
 * allowlist; the parser strips unknown keys silently.
 *
 * `appVersion` is stored on every export but is diagnostic-only —
 * the importer never validates it. Schema compatibility is governed
 * exclusively by `schemaVersion`.
 */

import { sanitizeScope } from '../envVarScopes';

export const PROFILE_SCHEMA_VERSION = 1;

export type ProfileImportPolicy = 'replace' | 'merge' | 'preserve';

/**
 * Subset of `SettingsState` that round-trips. Excludes:
 *   - `telemetryConsent` (machine-local consent)
 *   - `nativeExecutionAcknowledged` (machine-local one-shot)
 *   - `hasCompletedTour`, `lastSeenVersion`, `suppressTourAutoStart`
 *     (machine/build-local UX state)
 */
export interface PortableSettings {
  theme?: 'dark' | 'light';
  editorTheme?: string;
  fontSize?: number;
  fontFamily?: string;
  fontLigatures?: boolean;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  minimap?: boolean;
  layoutPreset?: string;
  loopProtection?: boolean;
  maxLoopIterations?: number;
  hideUndefined?: boolean;
  restoreSession?: boolean;
  formatOnSave?: boolean;
  vimMode?: boolean;
  syncShellWithEditorTheme?: boolean;
  executionHistorySnapshotEnabled?: boolean;
  language?: string;
  shortcutOverrides?: Record<string, readonly { tokens: readonly string[] }[]>;
  keymapPreset?: string;
  themePack?: string;
}

export interface PortableSnippet {
  id: string;
  language: string;
  label: string;
  description: string;
  code: string;
  createdAt: number;
}

export interface PortableEnvVars {
  global: Record<string, string>;
  project: Record<string, Record<string, string>>;
}

export interface LinguaProfile {
  schemaVersion: 1;
  /** ISO 8601. Diagnostic; not validated. */
  exportedAt: string;
  /** Diagnostic only — issue reports include it for support. Not validated on import. */
  appVersion: string;
  data: {
    settings: PortableSettings;
    snippets: PortableSnippet[];
    envVars: PortableEnvVars;
  };
}

export type ProfileImportError =
  | { kind: 'invalid-json'; message: string }
  | { kind: 'unsupported-version'; foundVersion: unknown }
  | { kind: 'invalid-shape'; field: string };

export type ProfileParseResult =
  | { ok: true; profile: LinguaProfile }
  | { ok: false; error: ProfileImportError };

const BOOLEAN_SETTINGS: readonly (keyof PortableSettings)[] = [
  'fontLigatures',
  'showLineNumbers',
  'wordWrap',
  'minimap',
  'loopProtection',
  'hideUndefined',
  'restoreSession',
  'formatOnSave',
  'vimMode',
  'syncShellWithEditorTheme',
  'executionHistorySnapshotEnabled',
];

const STRING_SETTINGS: readonly (keyof PortableSettings)[] = [
  'editorTheme',
  'fontFamily',
  'keymapPreset',
  'themePack',
];

const LAYOUT_PRESETS = new Set(['horizontal', 'vertical', 'editor-only']);
const APP_LANGUAGES = new Set(['system', 'en', 'es']);
const MAX_PROFILE_STRING_LENGTH = 512;

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PROFILE_STRING_LENGTH;
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickPortableSettings(raw: unknown): PortableSettings {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  for (const key of STRING_SETTINGS) {
    if (isBoundedString(raw[key])) out[key] = raw[key];
  }
  if (raw.theme === 'dark' || raw.theme === 'light') out.theme = raw.theme;
  if (isFiniteNumberInRange(raw.fontSize, 10, 32)) {
    out.fontSize = raw.fontSize;
  }
  if (isBoundedString(raw.layoutPreset) && LAYOUT_PRESETS.has(raw.layoutPreset)) {
    out.layoutPreset = raw.layoutPreset;
  }
  if (
    typeof raw.maxLoopIterations === 'number' &&
    [1000, 5000, 10000, 50000, 100000].includes(raw.maxLoopIterations)
  ) {
    out.maxLoopIterations = raw.maxLoopIterations;
  }
  if (isBoundedString(raw.language) && APP_LANGUAGES.has(raw.language)) {
    out.language = raw.language;
  }
  if (isPlainObject(raw.shortcutOverrides)) {
    out.shortcutOverrides = raw.shortcutOverrides;
  }
  return out as PortableSettings;
}

function pickPortableSnippets(raw: unknown): PortableSnippet[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    const { id, language, label, description, code, createdAt } = entry;
    if (
      typeof id !== 'string' ||
      typeof language !== 'string' ||
      typeof label !== 'string' ||
      typeof code !== 'string'
    ) {
      return [];
    }
    return [
      {
        id,
        language,
        label,
        description: typeof description === 'string' ? description : '',
        code,
        createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
      },
    ];
  });
}

function pickStringMap(raw: unknown): Record<string, string> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string') {
      out[key] = value;
    }
  }
  return sanitizeScope(out);
}

function pickPortableEnvVars(raw: unknown): PortableEnvVars {
  if (!isPlainObject(raw)) {
    return { global: {}, project: {} };
  }
  const project: Record<string, Record<string, string>> = {};
  if (isPlainObject(raw.project)) {
    for (const [projectId, scope] of Object.entries(raw.project)) {
      if (typeof projectId !== 'string') continue;
      const sanitized = pickStringMap(scope);
      if (Object.keys(sanitized).length > 0) {
        project[projectId] = sanitized;
      }
    }
  }
  return {
    global: pickStringMap(raw.global),
    project,
  };
}

/**
 * Migrate any input shape to the current LinguaProfile. The v0
 * fixture is a flat object with no envelope: synthetic, since we
 * never shipped a v0; included so the migrator plumbing exists and
 * future v2 → v3 lifts land cleanly.
 */
export function migrateProfile(input: unknown, appVersion = '0.0.0'): LinguaProfile {
  if (!isPlainObject(input)) {
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion,
      data: {
        settings: {},
        snippets: [],
        envVars: { global: {}, project: {} },
      },
    };
  }

  if (input.schemaVersion === PROFILE_SCHEMA_VERSION && isPlainObject(input.data)) {
    return {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(),
      appVersion: typeof input.appVersion === 'string' ? input.appVersion : appVersion,
      data: {
        settings: pickPortableSettings(input.data.settings),
        snippets: pickPortableSnippets(input.data.snippets),
        envVars: pickPortableEnvVars(input.data.envVars),
      },
    };
  }

  // v0 lift: flat shape with `settings` / `snippets` / `envVars`
  // peers at the root, no envelope, no schemaVersion.
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    data: {
      settings: pickPortableSettings(input.settings ?? input),
      snippets: pickPortableSnippets(input.snippets),
      envVars: pickPortableEnvVars(input.envVars),
    },
  };
}

export function parseAndValidateProfile(raw: string): ProfileParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'invalid-json',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: { kind: 'invalid-shape', field: 'root' } };
  }

  const version = parsed.schemaVersion;
  if (version !== undefined && version !== PROFILE_SCHEMA_VERSION) {
    // Reject explicit but unknown versions. Missing `schemaVersion`
    // falls through to the v0 lift in `migrateProfile`.
    return { ok: false, error: { kind: 'unsupported-version', foundVersion: version } };
  }

  if (version === PROFILE_SCHEMA_VERSION && !isPlainObject(parsed.data)) {
    return { ok: false, error: { kind: 'invalid-shape', field: 'data' } };
  }

  return { ok: true, profile: migrateProfile(parsed) };
}

/**
 * Build a Windows-safe filename for the export: ISO 8601 with `:`
 * replaced by `-` (Windows reserves `:` in filenames; macOS and
 * Linux accept the substitution without complaint).
 */
export function profileFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
  return `lingua-profile-${stamp}.json`;
}

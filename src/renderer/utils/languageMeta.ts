import type { Language } from '../types';
import { pluginRegistry } from '../plugins';
import {
  type LanguagePack,
  getLanguagePackById,
  getLanguagePackForExtension,
} from '../../shared/languagePacks';

/**
 * Thin compatibility shim for RL-038 Slice A. The single source of truth
 * for language metadata is now `src/shared/languagePacks.ts`. The legacy
 * function names below are preserved verbatim so existing call sites (the
 * Toolbar, language selectors, the runner manager, the editor opener, the
 * file tree, the snippets store, the templates module, the i18n loader)
 * keep compiling without per-call-site migration.
 *
 * Slices B and C in `LANGUAGE_PACK_ADR.md` migrate the consumers off
 * these shims one folder at a time. Until then, every helper that used
 * to read `BUILT_IN_LANGUAGE_META[language]` now reads
 * `getLanguagePackById(language)` and falls back to the same plaintext
 * shape on an unknown language.
 *
 * The display labels (`languageLabel`, `languageShortLabel`) intentionally
 * resolve to a localized string only at the call site — Slice C threads
 * `i18next.t` through the consumers. This shim returns the **English**
 * label as a stable fallback so non-React callers (template metadata,
 * file-tree titles before the renderer mounts) keep producing readable
 * strings until they migrate.
 */

type LanguageMeta = {
  label: string;
  shortLabel: string;
  badgeClass: string;
  textColorClass: string;
  extensions: readonly string[];
  fileNames?: readonly string[];
  monacoLanguage: string;
  defaultCode: string;
  executionMode: 'run' | 'validate' | 'view';
};

// Stable English fallback labels, mirrored against the i18n keys the pack
// declares. Slice C will replace these reads with `i18next.t(pack.labelKey)`
// at the React boundary.
const ENGLISH_FALLBACK_LABELS: Record<string, { label: string; shortLabel: string }> = {
  javascript: { label: 'JavaScript', shortLabel: 'JS' },
  typescript: { label: 'TypeScript', shortLabel: 'TS' },
  go: { label: 'Go', shortLabel: 'Go' },
  python: { label: 'Python', shortLabel: 'Py' },
  rust: { label: 'Rust', shortLabel: 'Rs' },
  lua: { label: 'Lua', shortLabel: 'Lua' },
  ruby: { label: 'Ruby', shortLabel: 'Rb' },
  c: { label: 'C', shortLabel: 'C' },
  cpp: { label: 'C++', shortLabel: 'C++' },
  swift: { label: 'Swift', shortLabel: 'Sw' },
  kotlin: { label: 'Kotlin', shortLabel: 'Kt' },
  json: { label: 'JSON', shortLabel: 'JSON' },
  yaml: { label: 'YAML', shortLabel: 'YML' },
  dotenv: { label: '.env', shortLabel: 'ENV' },
  toml: { label: 'TOML', shortLabel: 'TOML' },
  ini: { label: 'INI', shortLabel: 'INI' },
  csv: { label: 'CSV', shortLabel: 'CSV' },
  dockerfile: { label: 'Dockerfile', shortLabel: 'DKR' },
  makefile: { label: 'Makefile', shortLabel: 'MK' },
  gitignore: { label: 'Gitignore', shortLabel: 'GI' },
  editorconfig: { label: 'EditorConfig', shortLabel: 'EC' },
  shellscript: { label: 'Shell script', shortLabel: 'SH' },
};

const FALLBACK_META: LanguageMeta = {
  label: 'Text',
  shortLabel: 'TXT',
  badgeClass: 'bg-surface-strong text-muted-strong',
  textColorClass: 'text-muted',
  extensions: ['txt'],
  monacoLanguage: 'plaintext',
  defaultCode: '',
  executionMode: 'view',
};
const FALLBACK_EXTENSION = 'txt';

function packToMeta(pack: LanguagePack): LanguageMeta {
  const fallback = ENGLISH_FALLBACK_LABELS[pack.id];
  return {
    label: fallback?.label ?? pack.id,
    shortLabel: fallback?.shortLabel ?? pack.id.slice(0, 3).toUpperCase(),
    badgeClass: pack.badgeClass,
    textColorClass: pack.textColorClass,
    extensions: pack.extensions,
    ...(pack.fileNames ? { fileNames: pack.fileNames } : {}),
    monacoLanguage: pack.monacoLanguage,
    defaultCode: pack.defaultCode,
    // Slice A keeps the legacy `executionMode` enum (run / validate /
    // view) — `compile` packs map to `run` so existing callers don't
    // start hiding the Run button on Go and Rust by accident.
    executionMode: pack.execution === 'compile' ? 'run' : pack.execution,
  };
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./u, '').toLowerCase();
}

export function getLanguageMeta(language: Language): LanguageMeta {
  const pack = getLanguagePackById(language);
  if (pack) return packToMeta(pack);

  const plugin = pluginRegistry.getByLanguage(language);
  if (!plugin) return FALLBACK_META;

  const extension = plugin.extensions[0]?.replace(/^\./, '') || 'txt';
  const shortLabel = plugin.name.slice(0, 3).toUpperCase();

  return {
    label: plugin.name,
    shortLabel,
    badgeClass: FALLBACK_META.badgeClass,
    textColorClass: FALLBACK_META.textColorClass,
    extensions: [extension],
    monacoLanguage: plugin.monacoLanguage ?? 'plaintext',
    defaultCode: plugin.defaultCode ?? '',
    executionMode: 'run',
  };
}

export function languageForExtension(extension: string): Language | undefined {
  return getLanguagePackForExtension(normalizeExtension(extension))?.id;
}

export function languageLabel(language: Language): string {
  return getLanguageMeta(language).label;
}

export function languageShortLabel(language: Language): string {
  return getLanguageMeta(language).shortLabel;
}

export function languageBadgeClass(language: Language): string {
  return getLanguageMeta(language).badgeClass;
}

export function languageTextColorClass(language: Language): string {
  return getLanguageMeta(language).textColorClass;
}

export function extensionForLanguage(language: Language): string {
  return getLanguageMeta(language).extensions[0] ?? FALLBACK_EXTENSION;
}

export function monacoLanguageFor(language: Language): string {
  return getLanguageMeta(language).monacoLanguage;
}

export function defaultCodeForLanguage(language: Language): string {
  return getLanguageMeta(language).defaultCode;
}

export function executionModeForLanguage(language: Language): 'run' | 'validate' | 'view' {
  return getLanguageMeta(language).executionMode;
}

/**
 * RL-038 Slice C capability-aware UI — returns a stable i18n key
 * describing the host-toolchain expectation for the given language,
 * or `null` when the pack carries none (self-contained runtime or
 * bundled interpreter). The renderer looks this key up through
 * `useTranslation()` so the copy stays localized.
 */
export function languageCapabilityBadgeKey(language: Language): string | null {
  const pack = getLanguagePackById(language);
  const hasHostDependency =
    pack?.capabilities.runtimeDependencies !== undefined &&
    pack.capabilities.runtimeDependencies.length > 0;
  return hasHostDependency ? 'language.capability.desktopOnly' : null;
}

export function languageSupportsFileName(language: Language, fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  const fileNames = getLanguageMeta(language).fileNames ?? [];

  return fileNames.some((candidate) => candidate.toLowerCase() === normalized);
}

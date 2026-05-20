/**
 * RL-020 Slice 7 — shared timeout-preset enum + resolver.
 *
 * Lives in `src/shared/` so the renderer Settings UI, every runner,
 * the telemetry validators (renderer + update-server mirror), and
 * tests can import a single source of truth.
 *
 * Preset semantics:
 *
 * - `quick` — 5 s. For tight REPL exploration on JS / TS / Go where
 *   you want a runaway loop killed fast.
 * - `normal` — 30 s. The historical default for JS / TS / Go.
 * - `long` — 120 s. The default for Python (whose bootstrap +
 *   numerical workloads tend to take longer than JS) and a useful
 *   step up for everyone else.
 * - `extended` — 300 s. For deliberately long runs.
 *
 * The resolver is intentionally language-aware so we can keep the
 * Python default at `long` without hardcoding the number anywhere
 * else; the same map answers "how many ms for (language, preset)?"
 * for every caller.
 */
export const RUNTIME_TIMEOUT_PRESETS = [
  'quick',
  'normal',
  'long',
  'extended',
] as const;

export type RuntimeTimeoutPreset = (typeof RUNTIME_TIMEOUT_PRESETS)[number];

export const RUNTIME_TIMEOUT_PRESET_VALUES = new Set<string>(
  RUNTIME_TIMEOUT_PRESETS
);

const PRESET_MS: Record<RuntimeTimeoutPreset, number> = {
  quick: 5_000,
  normal: 30_000,
  long: 120_000,
  extended: 300_000,
};

/**
 * Languages whose run-time preset Slice 7 wires through. Rust
 * (desktop child-process kill in main) and the LSP-only entries are
 * intentionally out. RL-042 Slice 5 added Ruby once the @ruby/wasm-wasi
 * web runner shipped; the preset list drives the Settings UI rows so a
 * runnable web language must enroll or its row disappears.
 */
export const RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'go',
  'ruby',
] as const;

export type RuntimeTimeoutSupportedLanguage =
  (typeof RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES)[number];

export const RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET = new Set<string>(
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES
);

/**
 * Per-language default preset. Mirrors the pre-Slice-7 hardcoded
 * `DEFAULT_TIMEOUT` constants:
 *   javascript / typescript / go → 30 s → `normal`
 *   python                       → 60 s baseline → bumped to `long`
 *                                  (closer to the old value than
 *                                  `normal` and gives Pyodide-heavy
 *                                  workloads breathing room).
 */
export const RUNTIME_TIMEOUT_DEFAULT_PRESET: Record<
  RuntimeTimeoutSupportedLanguage,
  RuntimeTimeoutPreset
> = {
  javascript: 'normal',
  typescript: 'normal',
  python: 'long',
  go: 'normal',
  // RL-042 Slice 5 — Ruby's @ruby/wasm-wasi boot is comparable to
  // Pyodide's first run (~1-2s WASM compile), but per-run user code
  // is closer to Go's interpreted shape than to Python's numerical
  // workloads. `normal` (30s) matches what other web-WASM runtimes
  // settle on for first-pass scripts.
  ruby: 'normal',
};

export function isRuntimeTimeoutPreset(
  value: unknown
): value is RuntimeTimeoutPreset {
  return typeof value === 'string' && RUNTIME_TIMEOUT_PRESET_VALUES.has(value);
}

export function isRuntimeTimeoutSupportedLanguage(
  value: unknown
): value is RuntimeTimeoutSupportedLanguage {
  return (
    typeof value === 'string' &&
    RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET.has(value)
  );
}

export function defaultRuntimeTimeoutPreset(
  language: string
): RuntimeTimeoutPreset {
  if (isRuntimeTimeoutSupportedLanguage(language)) {
    return RUNTIME_TIMEOUT_DEFAULT_PRESET[language];
  }
  return 'normal';
}

/**
 * Resolve `(language, preset)` to milliseconds. Unknown preset or
 * language falls back to the language default (or `normal` for
 * unsupported languages).
 */
export function resolveTimeoutMs(
  language: string,
  preset: RuntimeTimeoutPreset | undefined | null
): number {
  if (isRuntimeTimeoutPreset(preset)) return PRESET_MS[preset];
  return PRESET_MS[defaultRuntimeTimeoutPreset(language)];
}

/**
 * Pure ms lookup for a preset, ignoring the language. Used by
 * Settings copy + tooltip strings ("hit the quick limit (5s)").
 */
export function presetToMs(preset: RuntimeTimeoutPreset): number {
  return PRESET_MS[preset];
}

/**
 * Seed map used by the settings store when no persisted value
 * exists. Copy-on-read so each consumer gets its own object.
 */
export function defaultRuntimeTimeoutPresetSeed(): Record<
  string,
  RuntimeTimeoutPreset
> {
  return {
    javascript: 'normal',
    typescript: 'normal',
    python: 'long',
    go: 'normal',
    ruby: 'normal',
  };
}

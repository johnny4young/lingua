/**
 * RL-019 Slice 1 — explicit per-tab JS/TS runtime modes.
 *
 * Contract:
 *   - `worker` — current default. Sandboxed Web Worker, no DOM, no
 *     Node built-ins. Fast and isolated; ideal for algorithm work.
 *   - `node` — desktop child-process Node. Built-ins (`fs`, `path`,
 *     `http`, `process`, ...) available. Slice 2 will wire the
 *     subprocess spawn + sandbox + timeouts. Disabled in Slice 1.
 *   - `browser-preview` — iframe-isolated context with DOM. Slice 3
 *     will land the preview pane. Disabled in Slice 1.
 *
 * `defaultRuntimeModeFor(language)` returns `'worker'` for JS/TS and
 * `null` for every other language. Non-JS/TS tabs intentionally
 * carry NO runtime-mode field — the selector renders only for
 * `javascript` / `typescript`, mirroring the language-pack
 * capability contract from RL-038.
 *
 * `isRuntimeModeImplemented(mode)` gates writes from the UI / the
 * keyboard cycle helper / the command palette — only `'worker'`
 * passes today. Future slices flip `'node'` and `'browser-preview'`
 * to true when their backends land.
 */

export const RUNTIME_MODES = ['worker', 'node', 'browser-preview'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

const RUNTIME_MODE_SET: ReadonlySet<string> = new Set(RUNTIME_MODES);

const JS_TS_LANGUAGES: ReadonlySet<string> = new Set(['javascript', 'typescript']);

/**
 * Languages for which the per-tab runtime-mode selector applies.
 * Mirror this with the Toolbar render guard. Adding a language to
 * this set requires (1) the runner registry to honour the mode and
 * (2) a CAPABILITY_MATRIX update.
 */
export function languageHasRuntimeModes(language: string | undefined): boolean {
  return typeof language === 'string' && JS_TS_LANGUAGES.has(language);
}

/**
 * Default mode for a freshly created tab. Returns `null` for any
 * language outside the JS/TS surface so non-JS/TS tabs never carry
 * a `runtimeMode` field on disk.
 */
export function defaultRuntimeModeFor(language: string | undefined): RuntimeMode | null {
  return languageHasRuntimeModes(language) ? 'worker' : null;
}

/**
 * Whether a mode is wired today. Slice 1 ships only `worker`; the
 * UI shows the other two as disabled and any programmatic write to
 * an unimplemented mode is rejected.
 */
export function isRuntimeModeImplemented(mode: RuntimeMode): boolean {
  return mode === 'worker';
}

/**
 * Coerce an arbitrary persisted value back to a valid RuntimeMode
 * for a given language, or `null` if the language does not own the
 * surface. Used by the session-store rehydrate path so a tampered
 * `lingua-session` localStorage entry cannot smuggle an unsupported
 * string into the runtime registry.
 */
export function coerceRuntimeMode(
  value: unknown,
  language: string | undefined
): RuntimeMode | null {
  if (!languageHasRuntimeModes(language)) return null;
  if (typeof value === 'string' && RUNTIME_MODE_SET.has(value)) {
    const mode = value as RuntimeMode;
    // Unknown-future modes coerce to `worker` so an older client
    // pulling a newer session entry cannot land in an unimplemented
    // mode silently.
    return isRuntimeModeImplemented(mode) ? mode : 'worker';
  }
  return 'worker';
}

/**
 * Return the next implemented mode after `current`, cycling through
 * `RUNTIME_MODES`. Used by the `Mod+Alt+M` shortcut (fold D). In
 * Slice 1 only `'worker'` is implemented, so the cycle is a no-op;
 * Slice 2/3 will land `'node'` and `'browser-preview'` and the same
 * helper picks up the new options automatically.
 */
export function cycleRuntimeMode(current: RuntimeMode): RuntimeMode {
  const implemented = RUNTIME_MODES.filter(isRuntimeModeImplemented);
  if (implemented.length === 0) return current;
  const idx = implemented.indexOf(current);
  // `current` is not implemented (e.g., a future regression that hands
  // an unimplemented mode to the cycle helper). Snap to the first
  // implemented option rather than crashing or leaving the user in an
  // unimplemented mode.
  if (idx < 0) return implemented[0]!;
  // Only one implemented option AND current is that option — the cycle
  // would loop back to the same value, so short-circuit.
  if (implemented.length === 1) return current;
  return implemented[(idx + 1) % implemented.length]!;
}

/**
 * implementation — explicit per-tab JS/TS runtime modes.
 *
 * Contract:
 *   - `worker` — current default. Sandboxed Web Worker, no DOM, no
 *     Node built-ins. Fast and isolated; ideal for algorithm work.
 *   - `node` — desktop child-process Node. Built-ins (`fs`, `path`,
 *     `http`, `process`, ...) available through the implementation
 *     subprocess spawn, timeout, and env allowlist in the desktop
 *     main process.
 *   - `browser-preview` — iframe-isolated context with DOM. implementation
 *     ships the preview pane.
 *   - `deno` / `bun` — desktop child-process alternatives for JS/TS.
 *     They execute TypeScript directly when the matching binary is on
 *     PATH and otherwise surface a detector-gated unavailable state.
 *
 * `defaultRuntimeModeFor(language)` returns `'worker'` for JS/TS and
 * `null` for every other language. Non-JS/TS tabs intentionally
 * carry NO runtime-mode field — the selector renders only for
 * `javascript` / `typescript`, mirroring the language-pack
 * capability contract from internal
 *
 * `isRuntimeModeImplemented(mode)` gates writes from the UI / the
 * keyboard cycle helper / the command palette. All three internal
 * internal modes plus the implementation Deno / Bun extension are implemented.
 */

import { isJavaScriptFamily } from './languageFamilies';

export const RUNTIME_MODES = ['worker', 'node', 'browser-preview', 'deno', 'bun'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

const RUNTIME_MODE_SET: ReadonlySet<string> = new Set(RUNTIME_MODES);

/**
 * Languages for which the per-tab runtime-mode selector applies.
 * Mirror this with the Toolbar render guard. Adding a language to the
 * runtime-mode surface requires (1) the runner registry to honour the
 * mode, (2) a CAPABILITY_MATRIX update, and (3) — if it is a new JS
 * dialect — membership in `JS_FAMILY_LANGUAGES`. Today the surface is
 * exactly the JS family, so this delegates to `isJavaScriptFamily`.
 */
export function languageHasRuntimeModes(language: string | undefined): boolean {
  return isJavaScriptFamily(language);
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
 * Whether a mode is wired today. implementation shipped `worker`; implementation
 * (2026-05-12) added `browser-preview`; **implementation (2026-05-14)
 * flipped `node` to enabled** once the desktop Node child-spawn
 * backend landed. The UI still renders the option as disabled when
 * the detector cannot find a `node` binary on PATH — that's a
 * platform-detection gate, not an implementation gate.
 */
export function isRuntimeModeImplemented(mode: RuntimeMode): boolean {
  return (
    mode === 'worker' ||
    mode === 'browser-preview' ||
    mode === 'node' ||
    // implementation — Deno / Bun desktop backends (src/main/altJsRuntimes.ts). Like
    // `node`, the UI still renders these disabled when the detector cannot
    // find the binary on PATH; that is a platform gate, not an impl gate.
    mode === 'deno' ||
    mode === 'bun'
  );
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
 * `RUNTIME_MODES`. Used by the `Mod+Alt+M` shortcut (implementation note).
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

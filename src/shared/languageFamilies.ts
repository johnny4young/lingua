/**
 * internal — single source of truth for the two language *membership*
 * sets that capability predicates across the app keep re-deriving
 * inline (`language === 'javascript' || language === 'typescript' ...`).
 *
 * Before this module the same two literals were copied into 9+ named
 * helpers and ~14 inline component/hook checks, so adding a language
 * to either family meant grepping for scattered string comparisons
 * and inevitably missing some. Centralising the membership here means
 * a new family member is a one-line edit to the relevant set.
 *
 * Both predicates are deliberately **string-typed** and depend on
 * nothing else in the codebase — mirroring the contract in
 * `runtimeModes.ts` and `autoRunGating.ts` — so this stays importable
 * from `src/shared`, `src/renderer`, tests, and any future standalone
 * fixture without dragging in the renderer `LANGUAGE_PACKS` registry.
 *
 * IMPORTANT — these encode *family membership / runtime architecture*,
 * not a single user-facing capability. Named capability helpers
 * (`languageSupportsStdin`, `isAppendWatchSupported`,
 * `languageHasRuntimeModes`, ...) delegate here today because their
 * membership is currently identical AND derives from the same root
 * cause. Each such helper is the seam to split at if a future language
 * ever joins a family without inheriting one specific capability.
 */

/**
 * The JavaScript language family: JS and its statically-typed dialect
 * TypeScript. This is a *linguistic* fact, not a capability claim —
 * features that happen to apply to exactly the JS family (runtime
 * modes, auto-log, the auto-run gate, browser preview) gate on it.
 */
export const JS_FAMILY_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
]);

/**
 * Languages whose primary runner executes in a Web Worker today:
 * JS / TS via `js-worker.ts` and Python via `python-worker.ts`. The
 * worker boundary is the reason stdin threading, the variable
 * inspector scope snapshot, `@watch` / magic-comment directives, and
 * the `runtime.stdin_used` telemetry all share this exact membership.
 * Go is WASM-based and Rust/Ruby compile-and-run on the host, so they
 * stay out until their patch surface is built.
 */
export const WORKER_RUNNER_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
  'python',
]);

/**
 * Whether `language` is JavaScript or TypeScript. Prefer a named
 * capability helper (e.g. `languageHasRuntimeModes`) at call sites
 * where one exists and matches the intent; use this directly only for
 * UI gates that have no dedicated capability predicate.
 */
export function isJavaScriptFamily(
  language: string | null | undefined
): boolean {
  return typeof language === 'string' && JS_FAMILY_LANGUAGES.has(language);
}

/**
 * Whether `language`'s runner goes through a Web Worker (JS / TS /
 * Python). The technical precondition for stdin, the variable
 * inspector, `@watch`, and magic-comment directives.
 */
export function isWorkerRunnerLanguage(
  language: string | null | undefined
): boolean {
  return typeof language === 'string' && WORKER_RUNNER_LANGUAGES.has(language);
}

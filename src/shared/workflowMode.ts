/**
 * RL-020 Slice 2 — per-tab workflow mode (Run / Debug / Scratchpad).
 *
 * Three discrete user intents that constrain what fires automatically
 * around the manual Run gesture:
 *
 *   - `scratchpad` — auto-run fires on debounced keystrokes (subject
 *     to the RL-020 Slice 1 completion gate). Default for languages
 *     that have a Scratchpad-class runner (JS / TS / Python today).
 *   - `run` — auto-run is OFF. Cmd+R still executes manually. Default
 *     for compiled / validate / view-only tabs.
 *   - `debug` — auto-run is OFF; the user intends to step through
 *     breakpoints. Only valid for languages that have a debugger
 *     adapter (JS / TS today, via `languageSupportsDebugger`). The
 *     manual Run gesture still works; this mode is mostly a UI hint
 *     and an auto-run silencer.
 *
 * The Run gesture (Cmd+R / toolbar button) executes in ALL three
 * modes — workflow mode does not constrain manual execution. It only
 * controls AUTOMATIC behavior around the gesture.
 *
 * Pure module: no DOM, no Monaco, no store imports. Safe under
 * `vitest --environment=node`. The renderer's `editorStore` and
 * `useAutoRun` consume these helpers; the language-capability axes
 * (Scratchpad-class runner; debugger-supported) are duplicated here
 * as small closed sets so this module stays import-cycle-free.
 *
 * Coupling discipline: any language added to
 * `SCRATCHPAD_CAPABLE_LANGUAGES` MUST also be added to
 * `INLINE_RESULT_LANGUAGES` in `src/renderer/utils/languageCapabilities.ts`
 * so the auto-run path produces per-line results consistently. Any
 * language added to `DEBUG_CAPABLE_LANGUAGES` MUST already be flagged
 * `capabilities.debugger === 'available'` in its language pack.
 */

export const WORKFLOW_MODES = ['run', 'debug', 'scratchpad'] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

const WORKFLOW_MODE_SET: ReadonlySet<string> = new Set(WORKFLOW_MODES);

/**
 * Languages that have a Scratchpad-class runner today (auto-run as
 * you type). The set is the union of every language with a registered
 * runner that goes through `useAutoRun` today:
 *
 *   - JS / TS / Python — Web Worker / Pyodide runners (web + desktop).
 *   - Go / Rust — desktop-only child-process runners (gated separately
 *     by the desktop-only / native-execution checks inside
 *     `useAutoRun`; from a workflow-mode standpoint they are still
 *     Scratchpad-capable).
 *
 * Picking a slightly wider set than the language defaults preserves
 * existing user behavior: anybody who was using auto-run on a Go or
 * Rust tab keeps that experience. A future slice may narrow the
 * Scratchpad default for heavy compile languages — but only behind a
 * setting change, not silently.
 */
const SCRATCHPAD_CAPABLE_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
  'python',
  'go',
  'rust',
]);

/**
 * Languages that have a debugger adapter today (RL-027 Slice 1.5).
 * Stays in sync with `languageSupportsDebugger` for the JS / TS pair.
 * Future debugger adapters (Python, Go, Rust) extend this set when
 * their language-pack capability flips to `available`.
 */
const DEBUG_CAPABLE_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
]);

/**
 * Is `value` one of the closed `WorkflowMode` enum strings?
 */
export function isWorkflowMode(value: unknown): value is WorkflowMode {
  return typeof value === 'string' && WORKFLOW_MODE_SET.has(value);
}

/**
 * Whether the given mode is meaningful for the given language.
 *
 *   - `run` — always supported. Every language has a manual Run
 *     gesture (or at minimum a validate-mode "diagnostics on save"
 *     surface) so this never returns false. The mode collapses to
 *     "no auto-run, manual gestures only" for view-only languages.
 *   - `debug` — only languages with a debugger adapter. JS / TS
 *     today; Python / Go / Rust as their adapters land.
 *   - `scratchpad` — only languages with a Scratchpad-class runner.
 *     JS / TS / Python in web + desktop; Go / Rust on desktop.
 *
 * The UI uses this to grey out unsupported segments in the toolbar
 * toggle and the language-defaults Settings row.
 */
export function supportsWorkflowMode(
  language: string | undefined,
  mode: WorkflowMode
): boolean {
  if (mode === 'run') return true;
  if (typeof language !== 'string') return false;
  if (mode === 'debug') return DEBUG_CAPABLE_LANGUAGES.has(language);
  // mode === 'scratchpad'
  return SCRATCHPAD_CAPABLE_LANGUAGES.has(language);
}

/**
 * Default workflow mode for a freshly created tab of the given
 * language. Scratchpad-capable languages default to `scratchpad`
 * so the live-results experience stays the discoverable default;
 * everything else defaults to `run` so a compiled-language buffer
 * does not look like a no-op (no auto-run = no surprise empty
 * panel until the user presses Cmd+R, paired with fold G's
 * mode-aware empty-state copy).
 */
export function defaultWorkflowMode(language: string | undefined): WorkflowMode {
  if (typeof language !== 'string') return 'run';
  return SCRATCHPAD_CAPABLE_LANGUAGES.has(language) ? 'scratchpad' : 'run';
}

/**
 * Coerce a value into a valid `WorkflowMode` for the given language.
 *
 * Falls through to `defaultWorkflowMode(language)` when:
 *   - `value` is not a closed-enum string.
 *   - `value` is one of the closed-enum strings but the language
 *     does not support that mode (e.g. a persisted `debug` mode on
 *     a Rust tab after the user switched the language).
 *
 * Used by:
 *   - the session-restore rehydrate path so a tampered or stale
 *     localStorage entry cannot smuggle an unsupported workflow
 *     mode into the live store.
 *   - the language-change handler in `editorStore` to flip the mode
 *     when the user changes a tab's language away from one that
 *     supported their explicit choice (e.g. JS Debug → Rust).
 */
export function coerceWorkflowMode(
  value: unknown,
  language: string | undefined
): WorkflowMode {
  if (isWorkflowMode(value) && supportsWorkflowMode(language, value)) {
    return value;
  }
  return defaultWorkflowMode(language);
}

/**
 * Return the next supported workflow mode after `current`, cycling
 * through `WORKFLOW_MODES` in declaration order while skipping
 * unsupported segments for the given language.
 *
 * Used by the `Mod+Shift+M` keyboard cycle (fold A). Behaviour:
 *
 *   - Only one supported mode → returns `current` unchanged (cycle
 *     would be a no-op).
 *   - `current` not supported by `language` → snaps to the first
 *     supported mode rather than crashing. This branch is reachable
 *     when a future regression hands an unsupported mode to the
 *     cycle helper (e.g. a Rust tab somehow carrying `debug`).
 */
export function cycleWorkflowMode(
  current: WorkflowMode,
  language: string | undefined
): WorkflowMode {
  const supported = WORKFLOW_MODES.filter((mode) =>
    supportsWorkflowMode(language, mode)
  );
  if (supported.length === 0) return current;
  if (supported.length === 1) return supported[0]!;
  const idx = supported.indexOf(current);
  if (idx < 0) return supported[0]!;
  return supported[(idx + 1) % supported.length]!;
}

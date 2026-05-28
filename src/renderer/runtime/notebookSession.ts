/**
 * RL-043 Slice A — Runner-owned notebook session manager.
 *
 * Per-tab session that keeps a long-lived sandbox object so cell N
 * can read variables declared in cells 1..N-1 WITHOUT polluting
 * the worker's `globalThis`. The 2026-05-20 research triage in
 * `docs/PLAN.md § RL-043` explicitly rejected raw `globalThis.eval()`
 * because it would bypass the runner instrumentation, timeout,
 * debugger, console, and stop contracts that already exist.
 *
 * Slice A architecture (JSON-serializable sandbox delta):
 *
 *   1. The session manager allocates one `NotebookSessionState` per
 *      `tabId`. The state holds a JSON-serializable sandbox object
 *      (string → primitive/object/array map) + in-flight flag.
 *   2. Each cell run composes a JavaScript source via
 *      `composeNotebookCellSource` that:
 *      - Wraps the user's cell code in `(async () => { ... })()`.
 *      - Pre-injects `const NAME = <JSON literal>;` for every
 *        existing sandbox key at the top of the body, so cell N
 *        reads of cell 1's declarations resolve naturally.
 *      - After the user's source, captures top-level
 *        `const`/`let`/`function` declarations into a
 *        `_sessionDelta` object (fold C regex rewriter).
 *      - Captures `console.log` / `.error` into stdout / stderr
 *        buffers.
 *      - Resolves to `{ stdout, stderr, sessionDelta }`.
 *   3. The renderer reads `result.result.sessionDelta` and merges it
 *      into the per-tab sandbox. JSON-only round-trip is the Slice A
 *      contract: primitives + plain objects + arrays survive;
 *      functions / class instances / Promises / Maps / Sets do NOT.
 *      Slice B+ promotes to a per-tab worker instance with a real
 *      shared `globalThis` so non-serializable values persist.
 *   4. Tab close + language change call `dispose(tabId)` which
 *      drops the sandbox object so the next session for the same
 *      tab id starts clean.
 *
 * The composed source runs through `runnerManager.execute` with the
 * existing JS / TS worker pipeline — so all RL-020 Slice 7 timeout
 * presets + RL-077 / RL-078 hardening apply unchanged.
 */

import { runnerManager } from '../runners';
import {
  NOTEBOOK_CELL_LANGUAGES,
  type NotebookCellLanguage,
} from '../../shared/notebook';

// ---------------------------------------------------------------------------
// Closed enums
// ---------------------------------------------------------------------------

/**
 * Per-cell run outcome bucket used by the telemetry event + the
 * status pill in the cell row. Mirrored on update-server with a
 * 3-way parity test cross-importing this canonical tuple.
 */
export const NOTEBOOK_CELL_STATUSES = ['ok', 'error', 'stopped'] as const;
export type NotebookCellStatus = (typeof NOTEBOOK_CELL_STATUSES)[number];

/**
 * Closed-enum reject reasons surfaced when the manager refuses to
 * run a cell. The UI maps each code to a localized hint via
 * `notebook.notice.<reason>` i18n keys.
 */
export const NOTEBOOK_SESSION_REJECT_REASONS = [
  'language-not-supported',
  'session-disposed',
  'concurrent-run',
] as const;
export type NotebookSessionRejectReason =
  (typeof NOTEBOOK_SESSION_REJECT_REASONS)[number];

/**
 * Slice A code-cell run gate. Mirrors the runner's `'javascript'`
 * pipeline; TypeScript routes through the same worker via Monaco's
 * TS transpile step (deferred to Slice B for cleanliness — Slice A
 * runner-side gate is JS only).
 */
export const NOTEBOOK_RUNNABLE_LANGUAGES: ReadonlySet<NotebookCellLanguage> =
  new Set(['javascript']);

export function isNotebookRunnableLanguage(
  language: NotebookCellLanguage
): boolean {
  return NOTEBOOK_RUNNABLE_LANGUAGES.has(language);
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/** Hard cap per output text length. Mirrors `MAX_OUTPUT_TEXT_LENGTH` in the
 * schema so a cell run can't produce a single output bigger than what
 * `parseNotebook` allows on rehydrate. */
export const MAX_NOTEBOOK_CELL_OUTPUT_TEXT_LENGTH = 16 * 1024;

/** Hard cap on total outputs per cell run. */
export const MAX_NOTEBOOK_CELL_OUTPUTS = 50;

/** Hard cap on the number of sandbox keys that survive cross-cell. Bounds
 * the cost of the pull-in injection step + the JSON serialization of the
 * delta. */
export const MAX_NOTEBOOK_SANDBOX_KEYS = 128;

// ---------------------------------------------------------------------------
// Composed-source helpers
// ---------------------------------------------------------------------------

/**
 * Fold C — rewrite top-level `const NAME = …;` / `let NAME = …;` /
 * `function NAME(...) { ... }` declarations to ALSO assign onto the
 * local `_sessionDelta` object so the post-run capture step sees
 * them. ONLY top-level declarations (those starting at column zero,
 * no leading whitespace) are rewritten — nested declarations inside
 * `if` / `for` / functions stay local + invisible to subsequent cells.
 *
 * Limitations (honest Slice A scope; Slice B+ adopts a TypeScript
 * AST rewriter via Monaco's TS service):
 *
 *   - Destructuring patterns (`const { a, b } = obj;`) are NOT
 *     rewritten — they execute as block-scoped local. Cell 2 won't
 *     see `a` / `b`. Documented in the panel UI.
 *   - Multi-line declarations whose first line doesn't end with
 *     `;` / `)` / `]` are skipped to avoid emitting an assignment
 *     before the right-hand-side completes (which would throw at
 *     runtime). The local binding still works in-cell.
 *   - `class Name { ... }` declarations are NOT rewritten. Use
 *     `const Name = class { ... }` to share across cells.
 *
 * The rewrite preserves source ordering and never deletes user code;
 * it only injects `_sessionDelta.NAME = NAME;` after the
 * declaration so the original local binding still resolves
 * normally inside the SAME cell.
 */
export function rewriteTopLevelDeclarationsForSession(source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  const topLevelDeclRe = /^(const|let)\s+([A-Za-z_$][\w$]*)\s*=/;
  const topLevelFnRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const topLevelAsyncFnRe = /^async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/;
  for (const line of lines) {
    out.push(line);
    // Only column-zero declarations: a leading whitespace char
    // means "nested" (inside an if / for / function block) and we
    // intentionally leave those local.
    if (/^[ \t]/.test(line)) continue;
    const declMatch = topLevelDeclRe.exec(line);
    if (declMatch) {
      const name = declMatch[2]!;
      // Detect multi-line declarations (e.g. `const x = {`) by
      // requiring the line to end with a closed expression. If
      // unclear, skip the rewrite — the local binding still works
      // in-cell, just won't survive cross-cell.
      const trimmed = line.trimEnd();
      if (trimmed.endsWith(';') || trimmed.endsWith(')') || trimmed.endsWith(']')) {
        out.push(`try { _sessionDelta.${name} = ${name}; } catch { /* non-serializable */ }`);
      }
      continue;
    }
    const fnMatch = topLevelFnRe.exec(line) ?? topLevelAsyncFnRe.exec(line);
    if (fnMatch) {
      const name = fnMatch[1]!;
      // Function declarations are hoisted so the assignment runs
      // safely after the line in source order. Functions are NOT
      // JSON-serializable, so the assignment will fail the
      // structural-clone-equivalent check in `extractSerializableDelta`
      // below — Slice B+ promotes to a worker sandbox that retains
      // function references natively.
      out.push(`try { _sessionDelta.${name} = ${name}; } catch { /* non-serializable */ }`);
    }
  }
  return out.join('\n');
}

/**
 * Compose the JavaScript source for one cell run. The output is the
 * BODY of an `AsyncFunction` invoked by the JS worker
 * (`new AsyncFunction(...)(...)`).
 *
 * Cell-N reads of cell-1's declarations resolve via the pull-in
 * step at the top of the composed body: every existing sandbox key
 * is injected as `const KEY = <JSON literal>;`. After the user's
 * source runs, the rewriter's `_sessionDelta` object is returned
 * and merged into the per-tab sandbox by the renderer.
 */
export function composeNotebookCellSource(
  userSource: string,
  sandbox: Readonly<Record<string, unknown>>
): string {
  const rewritten = rewriteTopLevelDeclarationsForSession(userSource);
  // Pull-ins: emit `const KEY = <JSON literal>;` for every existing
  // sandbox key. Each key is a `[A-Za-z_$][\w$]*` slug (rewriter only
  // accepts these). JSON.stringify the value so primitives + plain
  // objects + arrays round-trip cleanly.
  const pullInLines: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(sandbox)) {
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_NOTEBOOK_SANDBOX_KEYS) break;
    let literal: string;
    try {
      literal = JSON.stringify(sandbox[key]);
    } catch {
      continue;
    }
    if (literal === undefined) continue;
    pullInLines.push(`  const ${key} = ${literal};`);
  }
  return [
    'return (async () => {',
    '  "use strict";',
    '  const _sessionDelta = {};',
    '  const __notebook_console_buffer_stdout = [];',
    '  const __notebook_console_buffer_stderr = [];',
    '  const __notebook_original_log = console.log.bind(console);',
    '  const __notebook_original_error = console.error.bind(console);',
    '  const __notebook_capture = (buffer, ...args) => {',
    '    try {',
    '      const text = args',
    '        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))',
    '        .join(" ");',
    `      if (buffer.length < ${MAX_NOTEBOOK_CELL_OUTPUTS}) {`,
    `        buffer.push(text.length > ${MAX_NOTEBOOK_CELL_OUTPUT_TEXT_LENGTH} ? text.slice(0, ${MAX_NOTEBOOK_CELL_OUTPUT_TEXT_LENGTH - 1}) + "…" : text);`,
    '      }',
    '    } catch { /* ignore stringify failures */ }',
    '  };',
    '  console.log = (...args) => {',
    '    __notebook_capture(__notebook_console_buffer_stdout, ...args);',
    '    __notebook_original_log(...args);',
    '  };',
    '  console.error = (...args) => {',
    '    __notebook_capture(__notebook_console_buffer_stderr, ...args);',
    '    __notebook_original_error(...args);',
    '  };',
    '  try {',
    ...pullInLines,
    rewritten,
    '  } finally {',
    '    console.log = __notebook_original_log;',
    '    console.error = __notebook_original_error;',
    '  }',
    '  return { stdout: __notebook_console_buffer_stdout, stderr: __notebook_console_buffer_stderr, sessionDelta: _sessionDelta };',
    '})();',
  ].join('\n');
}

/**
 * Filter a raw sessionDelta to JSON-serializable entries only. The
 * composed source's `try { _sessionDelta.NAME = NAME; } catch` block
 * swallows the throw on non-assignable values, but a stray Function
 * or Map could still land in the delta if its property descriptors
 * happen to allow it. We post-filter here for defense in depth.
 */
export function extractSerializableDelta(
  raw: unknown
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const safe: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) continue;
    try {
      const literal = JSON.stringify(value);
      if (literal === undefined) continue;
      safe[key] = JSON.parse(literal);
      count += 1;
      if (count >= MAX_NOTEBOOK_SANDBOX_KEYS) break;
    } catch {
      continue;
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Session manager
// ---------------------------------------------------------------------------

interface NotebookSessionState {
  /** JSON-serializable sandbox object. Keys are top-level declaration
   * names captured by the rewriter; values are JSON-round-trippable. */
  sandbox: Record<string, unknown>;
  /** Per-cell in-flight flag — Slice A blocks `'concurrent-run'`. */
  isRunning: boolean;
}

const sessions = new Map<string, NotebookSessionState>();

function getOrCreateSession(tabId: string): NotebookSessionState {
  let state = sessions.get(tabId);
  if (!state) {
    state = { sandbox: {}, isRunning: false };
    sessions.set(tabId, state);
  }
  return state;
}

export interface NotebookCellRunOutcome {
  readonly status: NotebookCellStatus;
  /** stdout entries captured by the cell's `console.log` patch. */
  readonly stdout: ReadonlyArray<string>;
  /** stderr entries captured by `console.error` AND the thrown error message. */
  readonly stderr: ReadonlyArray<string>;
  /** Optional rejection reason; populated when status === 'error'. */
  readonly errorMessage?: string;
  /** Number of sandbox keys after merge (post-run). For tests + tooling. */
  readonly sandboxKeyCount: number;
}

export type NotebookCellRunResult =
  | { readonly ok: true; readonly outcome: NotebookCellRunOutcome }
  | { readonly ok: false; readonly reason: NotebookSessionRejectReason };

export interface NotebookCellRunRequest {
  readonly tabId: string;
  readonly language: NotebookCellLanguage;
  readonly source: string;
  /** Optional timeout ms; falls back to the runner default. */
  readonly timeoutMs?: number;
}

/**
 * Execute one cell against the session sandbox. Always settles to a
 * discriminated outcome — never throws.
 *
 * Concurrency: Slice A blocks `'concurrent-run'` for the SAME tab.
 * The renderer can still run cells in different notebook tabs in
 * parallel (each tab has its own session + sandbox).
 */
export async function runNotebookCell(
  request: NotebookCellRunRequest
): Promise<NotebookCellRunResult> {
  if (!isNotebookRunnableLanguage(request.language)) {
    return { ok: false, reason: 'language-not-supported' };
  }
  const session = getOrCreateSession(request.tabId);
  if (session.isRunning) {
    return { ok: false, reason: 'concurrent-run' };
  }
  session.isRunning = true;
  try {
    const composed = composeNotebookCellSource(request.source, session.sandbox);
    const result = await runnerManager.execute('javascript', composed, {
      language: 'javascript',
      ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
    });
    if (result.kind === 'stopped' || result.cancelled === true) {
      return {
        ok: true,
        outcome: {
          status: 'stopped',
          stdout: [],
          stderr: [],
          sandboxKeyCount: Object.keys(session.sandbox).length,
        },
      };
    }
    const errorMessage = result.error?.message;
    if (errorMessage !== undefined && errorMessage.length > 0) {
      return {
        ok: true,
        outcome: {
          status: 'error',
          stdout: flattenStdoutText(result.stdout),
          stderr: [...flattenStdoutText(result.stderr), errorMessage],
          errorMessage,
          sandboxKeyCount: Object.keys(session.sandbox).length,
        },
      };
    }
    // The composed source resolves to `{ stdout, stderr, sessionDelta }`.
    // Fall back to the runner's own stdout/stderr arrays when the
    // resolved value is missing (defensive — should never happen for
    // a clean run).
    const composedResult = result.result;
    let composedStdout: string[] = [];
    let composedStderr: string[] = [];
    let sessionDelta: unknown = {};
    if (
      composedResult !== undefined &&
      composedResult !== null &&
      typeof composedResult === 'object'
    ) {
      const obj = composedResult as Record<string, unknown>;
      if (Array.isArray(obj.stdout)) {
        composedStdout = obj.stdout
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(0, MAX_NOTEBOOK_CELL_OUTPUTS);
      }
      if (Array.isArray(obj.stderr)) {
        composedStderr = obj.stderr
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(0, MAX_NOTEBOOK_CELL_OUTPUTS);
      }
      sessionDelta = obj.sessionDelta;
    }
    if (composedStdout.length === 0) {
      composedStdout = flattenStdoutText(result.stdout);
    }
    if (composedStderr.length === 0) {
      composedStderr = flattenStdoutText(result.stderr);
    }
    // Merge the new top-level declarations into the per-tab sandbox.
    // The filter pass drops any non-serializable values defensively.
    const safeDelta = extractSerializableDelta(sessionDelta);
    session.sandbox = enforceSandboxCap({ ...session.sandbox, ...safeDelta });
    return {
      ok: true,
      outcome: {
        status: 'ok',
        stdout: composedStdout,
        stderr: composedStderr,
        sandboxKeyCount: Object.keys(session.sandbox).length,
      },
    };
  } finally {
    session.isRunning = false;
  }
}

function enforceSandboxCap(
  sandbox: Record<string, unknown>
): Record<string, unknown> {
  const keys = Object.keys(sandbox);
  if (keys.length <= MAX_NOTEBOOK_SANDBOX_KEYS) return sandbox;
  const trimmed: Record<string, unknown> = {};
  // Keep the LAST `MAX_NOTEBOOK_SANDBOX_KEYS` keys — most recent
  // declarations win, matching Jupyter's "later cell shadows earlier"
  // intuition.
  const kept = keys.slice(keys.length - MAX_NOTEBOOK_SANDBOX_KEYS);
  for (const key of kept) {
    trimmed[key] = sandbox[key];
  }
  return trimmed;
}

/**
 * Dispose the per-tab session. Drops the sandbox + flips the run
 * flag back to clean. Idempotent — calling on an unknown tabId is a
 * no-op. Always invoked by `editorStore.removeTab` + on language
 * change.
 */
export function disposeNotebookSession(tabId: string): void {
  const state = sessions.get(tabId);
  if (!state) return;
  state.isRunning = false;
  sessions.delete(tabId);
}

/**
 * Reset the global session map. Test-only seam so tests don't bleed
 * sandbox state across cases.
 */
export function resetNotebookSessionsForTests(): void {
  for (const tabId of sessions.keys()) {
    disposeNotebookSession(tabId);
  }
}

/**
 * Read the sandbox keys for a given session. Used by tests + Slice
 * B+ "Session inspector" affordance.
 */
export function getNotebookSessionKeys(tabId: string): string[] {
  const state = sessions.get(tabId);
  if (!state) return [];
  return Object.keys(state.sandbox);
}

/**
 * Read the full sandbox snapshot for a given session. Test-only
 * seam; the production UI uses `getNotebookSessionKeys` + targeted
 * lookups.
 */
export function getNotebookSessionSnapshotForTests(
  tabId: string
): Record<string, unknown> | undefined {
  const state = sessions.get(tabId);
  if (!state) return undefined;
  return { ...state.sandbox };
}

function flattenStdoutText(
  entries: ReadonlyArray<{ args: string[] }> | undefined
): string[] {
  if (!entries) return [];
  const lines: string[] = [];
  for (const entry of entries) {
    const text = entry.args
      .map((a) => (typeof a === 'string' ? a : String(a)))
      .join(' ');
    if (text.length === 0) continue;
    lines.push(
      text.length > MAX_NOTEBOOK_CELL_OUTPUT_TEXT_LENGTH
        ? `${text.slice(0, MAX_NOTEBOOK_CELL_OUTPUT_TEXT_LENGTH - 1)}…`
        : text
    );
    if (lines.length >= MAX_NOTEBOOK_CELL_OUTPUTS) break;
  }
  return lines;
}

/**
 * Closed-enum surface re-export — convenience for tests + UI gates.
 */
export type { NotebookCellLanguage };
export { NOTEBOOK_CELL_LANGUAGES };

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
 *   3. The renderer reads `result.structuredResult.sessionDelta` and
 *      merges it into the per-tab sandbox. The run sets
 *      `captureStructuredResult` so the worker forwards the live
 *      `{ stdout, stderr, sessionDelta }` object via the postMessage
 *      structured clone — NOT `result.result`, which is a display string
 *      the worker truncates at MAX_RESULT_BYTES (that truncation silently
 *      dropped the cross-cell delta before RL-043 Slice B). JSON-only
 *      round-trip is still the sandbox contract: primitives + plain
 *      objects + arrays survive; functions / class instances / Promises /
 *      Maps / Sets do NOT. A later slice promotes to a per-tab worker
 *      instance with a real shared `globalThis` so non-serializable
 *      values persist.
 *   4. Tab close + language change call `dispose(tabId)` which
 *      drops the sandbox object so the next session for the same
 *      tab id starts clean.
 *
 * The composed source runs through `runnerManager.execute` with the
 * existing JS / TS worker pipeline — so all RL-020 Slice 7 timeout
 * presets + RL-077 / RL-078 hardening apply unchanged.
 */

// Type-only import is fully erased at build, so it adds ZERO bundle
// weight. The TypeScript COMPILER (~2.5 MB) is loaded lazily via the
// dynamic `import('typescript')` in `loadTypescript()` below — a
// separate async chunk fetched only when a cell first runs, NOT inlined
// into the notebook chunk (RL-043 Slice B bundle guard).
import type * as TsTypes from 'typescript';
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
 * Code-cell run gate. JavaScript runs directly; TypeScript (RL-043
 * Slice C) is type-stripped to JavaScript via `ts.transpileModule`
 * (the same lazily-loaded compiler the cross-cell rewriter uses) and
 * then runs through the identical `'javascript'` worker pipeline, so
 * cross-cell sharing, timeouts, and the structured-result channel all
 * apply unchanged. Python (RL-043 Slice F) runs through the existing
 * Python runner (web Pyodide / desktop native) but INDEPENDENTLY per
 * cell — it does NOT join the JS composed-source + serialized-sandbox
 * cross-cell channel (that channel only round-trips JS values). True
 * cross-cell Python state needs a persistent interpreter and stays a
 * separate future slice.
 */
export const NOTEBOOK_RUNNABLE_LANGUAGES: ReadonlySet<NotebookCellLanguage> =
  new Set(['javascript', 'typescript', 'python']);

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
 * Lazily-loaded TypeScript compiler. Cached as a Promise so concurrent
 * cell runs share one load. Dynamic import keeps the ~2.5 MB compiler
 * in its own async chunk (fetched on first cell run) instead of inlined
 * into the notebook chunk.
 */
let cachedTypescript: Promise<typeof TsTypes> | null = null;
function loadTypescript(): Promise<typeof TsTypes> {
  if (cachedTypescript === null) {
    // Reset the cache on a rejected import so a transient chunk-load
    // failure (corrupt asset, disk error) doesn't permanently break
    // every later cell run — the next run re-attempts. Mirrors the
    // `getDuckDbEngine` cache-reset precedent.
    cachedTypescript = import('typescript').catch((err: unknown) => {
      cachedTypescript = null;
      throw err;
    });
  }
  return cachedTypescript;
}

/**
 * RL-043 Slice C — outcome of type-stripping a TypeScript cell. `js` is
 * the emitted JavaScript on success; `message` carries a human-readable
 * compiler diagnostic (with a `line:col` suffix — fold B) when the cell
 * has a syntax error, so the cell surfaces a precise message instead of
 * a generic failure.
 */
export type NotebookTranspileResult =
  | { readonly ok: true; readonly js: string }
  | { readonly ok: false; readonly message: string };

/**
 * RL-043 Slice C — type-strip a TypeScript cell to JavaScript so it runs
 * through the JS worker pipeline. Uses `ts.transpileModule` on the
 * already-lazily-loaded compiler (no extra dependency, no esbuild-wasm
 * fetch on the notebook path). `module: Preserve` + `target: ES2022`
 * type-strips without inventing an `export {}` module marker for
 * type-only imports/exports; value imports/exports remain unsupported
 * cell-module syntax and naturally surface as run errors. `enum` /
 * `namespace` emit a serializable runtime value that the cross-cell
 * rewriter then captures.
 *
 * `transpileModule` does NOT type-check; the reported diagnostics are
 * parser-level syntax errors only. We surface the first one (fold B) and
 * leave a clean cell unchanged. The emitted JS then flows through the
 * existing rewriter + `composeNotebookCellSource` untouched, so a TS
 * cell shares declarations cross-cell exactly like a JS cell.
 */
export async function transpileTypescriptCell(
  source: string
): Promise<NotebookTranspileResult> {
  const ts = await loadTypescript();
  const result = ts.transpileModule(source, {
    fileName: 'notebook-cell.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
    },
  });
  const firstError = (result.diagnostics ?? []).find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (firstError !== undefined) {
    const text = ts.flattenDiagnosticMessageText(firstError.messageText, '\n');
    let position = '';
    if (firstError.file !== undefined && typeof firstError.start === 'number') {
      const { line, character } =
        firstError.file.getLineAndCharacterOfPosition(firstError.start);
      // 1-based for display, mirroring how editors report TS errors.
      position = ` (${line + 1}:${character + 1})`;
    }
    return { ok: false, message: `TypeScript: ${text}${position}` };
  }
  return { ok: true, js: result.outputText };
}

/**
 * Collect every identifier a binding name introduces, recursing through
 * object + array destructuring patterns (rest, renamed, defaults, and
 * array holes). `const { a: x, ...rest } = obj` yields `['x', 'rest']`;
 * `const [, y] = arr` yields `['y']`. `tsApi` is the lazily-loaded
 * compiler module (passed in so this helper stays free of a static
 * `typescript` value import).
 */
function collectBindingNames(
  tsApi: typeof TsTypes,
  name: TsTypes.BindingName,
  out: string[]
): void {
  if (tsApi.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  // ObjectBindingPattern | ArrayBindingPattern — both expose `.elements`
  // of BindingElement (each carrying its own `.name: BindingName`), with
  // array patterns also allowing OmittedExpression holes.
  for (const element of name.elements) {
    if (tsApi.isOmittedExpression(element)) continue;
    collectBindingNames(tsApi, element.name, out);
  }
}

/**
 * RL-043 Slice B — rewrite top-level declarations to ALSO assign their
 * bindings onto the local `_sessionDelta` object so the post-run capture
 * step shares them with later cells. ONLY top-level statements are
 * rewritten — declarations nested inside `if` / `for` / functions stay
 * local + invisible to subsequent cells, exactly as before.
 *
 * This replaces the Slice A column-zero regex with a TypeScript-AST walk
 * (`ts.createSourceFile`), which robustly handles the cases the regex
 * could not: object/array destructuring (incl. rest, renamed, defaults,
 * holes), multi-line declarations, `var`, and `class Name {}` — all now
 * shared across cells.
 *
 * The rewrite preserves source ordering and never deletes user code: it
 * splices `try { _sessionDelta.NAME = NAME; } catch {}` in after each
 * top-level declaration's end, so the original binding still resolves
 * normally inside the SAME cell. Functions / classes are not
 * JSON-serializable, so their delta assignment is dropped by
 * `extractSerializableDelta`; the in-cell binding is unaffected.
 *
 * A parse failure (invalid JS) returns the source unchanged — the run
 * pipeline surfaces the syntax error as it does today.
 *
 * Async because the TypeScript compiler is loaded lazily (see
 * `loadTypescript`); the only caller (`composeNotebookCellSource`)
 * already runs inside the async `runNotebookCell` path.
 */
export async function rewriteTopLevelDeclarationsForSession(
  source: string
): Promise<string> {
  const ts = await loadTypescript();
  const sourceFile = ts.createSourceFile(
    'notebook-cell.js',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.JS
  );
  // `createSourceFile` is intentionally tolerant and still returns a tree for
  // broken input. Do not splice into that recovery tree: the user's original
  // syntax error is clearer than a secondary error from a best-effort insert.
  const parseDiagnostics = (
    sourceFile as TsTypes.SourceFile & {
      parseDiagnostics?: ReadonlyArray<unknown>;
    }
  ).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) return source;
  // One insertion per top-level declaration: its source end offset + the
  // names it binds. Uninitialized top-level variables are deferred to
  // end-of-cell because TypeScript lowers `enum` / `namespace` to
  // `var Name; (function (Name) { ... })(Name || (Name = {}));`;
  // capturing immediately after `var Name;` would snapshot `undefined`
  // and drop the serializable object those TS constructs create.
  const inserts: Array<{ end: number; names: string[] }> = [];
  const deferredVariableNames: string[] = [];
  for (const statement of sourceFile.statements) {
    const names: string[] = [];
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const declarationNames: string[] = [];
        collectBindingNames(ts, declaration.name, declarationNames);
        if (declaration.initializer === undefined) {
          deferredVariableNames.push(...declarationNames);
        } else {
          names.push(...declarationNames);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    }
    if (names.length > 0) {
      inserts.push({ end: statement.end, names });
    }
  }
  if (deferredVariableNames.length > 0) {
    inserts.push({ end: source.length, names: deferredVariableNames });
  }
  if (inserts.length === 0) return source;
  // Splice descending so earlier end offsets stay valid as we insert.
  let out = source;
  for (let i = inserts.length - 1; i >= 0; i -= 1) {
    const insert = inserts[i]!;
    const assignments = insert.names
      .map(
        (name) =>
          `try { _sessionDelta.${name} = ${name}; } catch { /* non-serializable */ }`
      )
      .join('\n');
    out = `${out.slice(0, insert.end)}\n${assignments}${out.slice(insert.end)}`;
  }
  return out;
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
export async function composeNotebookCellSource(
  userSource: string,
  sandbox: Readonly<Record<string, unknown>>
): Promise<string> {
  const rewritten = await rewriteTopLevelDeclarationsForSession(userSource);
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

/**
 * Allocate the sandbox only when the first cell actually runs. Notebook tabs
 * can be created, renamed, rehydrated, and deleted without ever touching the
 * runner layer; lazy allocation keeps those UI-only flows from pulling runtime
 * state into memory and gives `disposeNotebookSession` a simple Map delete.
 */
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
  /**
   * FASE 4 — the top-level declaration names this cell PRODUCED
   * (`Object.keys(safeDelta)`), i.e. the new sandbox keys the merge
   * added on the ok path. Surfaced as the `→ name` variable-flow chip
   * in the cell header. Empty on stopped / error / non-producing runs.
   * Additive only — this does NOT change the kernel merge behavior.
   */
  readonly producedKeys: ReadonlyArray<string>;
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
    // RL-043 Slice F — Python cells run through the existing Python
    // runner (web Pyodide / desktop native) INDEPENDENTLY: no composed
    // source, no JS sandbox injection, no structured-result channel
    // (those serialize JS values). The per-tab JS sandbox is left
    // untouched and `producedKeys` is empty — cross-cell Python state is
    // a separate future slice. stdout / stderr / error / stopped map
    // straight onto the outcome.
    if (request.language === 'python') {
      const result = await runnerManager.execute('python', request.source, {
        language: 'python',
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
      });
      const sandboxKeyCount = Object.keys(session.sandbox).length;
      if (result.kind === 'stopped' || result.cancelled === true) {
        return {
          ok: true,
          outcome: {
            status: 'stopped',
            stdout: [],
            stderr: [],
            sandboxKeyCount,
            producedKeys: [],
          },
        };
      }
      const stdout = flattenStdoutText(result.stdout);
      const stderr = flattenStdoutText(result.stderr);
      const errorMessage = result.error?.message;
      if (errorMessage !== undefined && errorMessage.length > 0) {
        return {
          ok: true,
          outcome: {
            status: 'error',
            stdout,
            stderr: [...stderr, errorMessage],
            errorMessage,
            sandboxKeyCount,
            producedKeys: [],
          },
        };
      }
      return {
        ok: true,
        outcome: {
          status: 'ok',
          stdout,
          stderr,
          sandboxKeyCount,
          producedKeys: [],
        },
      };
    }
    // RL-043 Slice C — TypeScript cells are type-stripped to JavaScript
    // BEFORE the rewriter + compose, then run through the identical JS
    // pipeline. A transpile (syntax) error short-circuits to an `error`
    // outcome carrying the precise compiler message (fold B); JS cells
    // skip this hop entirely.
    let runnableSource = request.source;
    if (request.language === 'typescript') {
      const transpiled = await transpileTypescriptCell(request.source);
      if (!transpiled.ok) {
        return {
          ok: true,
          outcome: {
            status: 'error',
            stdout: [],
            stderr: [transpiled.message],
            errorMessage: transpiled.message,
            sandboxKeyCount: Object.keys(session.sandbox).length,
            producedKeys: [],
          },
        };
      }
      runnableSource = transpiled.js;
    }
    const composed = await composeNotebookCellSource(
      runnableSource,
      session.sandbox
    );
    const result = await runnerManager.execute('javascript', composed, {
      language: 'javascript',
      // RL-043 Slice B — ask the worker to forward the cell's structured
      // return value losslessly on `result.structuredResult`. The default
      // `result.result` is a display string the worker truncates at
      // MAX_RESULT_BYTES, which silently dropped the cross-cell delta.
      captureStructuredResult: true,
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
          producedKeys: [],
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
          producedKeys: [],
        },
      };
    }
    // The composed source resolves to `{ stdout, stderr, sessionDelta }`,
    // forwarded losslessly as `structuredResult` because we set
    // `captureStructuredResult` on the run (NOT `result.result`, which is
    // a truncated display string). Fall back to the runner's own
    // stdout/stderr arrays when the structured value is missing (defensive
    // — e.g. a non-cloneable return, which should never happen for the
    // JSON-clean composed object).
    const composedResult = result.structuredResult;
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
    // FASE 4 — capture the produced keys BEFORE the cap merge so the
    // variable-flow chip reflects exactly what this cell declared. The
    // cap merge below can only ever drop OLDER keys, never these.
    const producedKeys = Object.keys(safeDelta);
    session.sandbox = enforceSandboxCap({ ...session.sandbox, ...safeDelta });
    return {
      ok: true,
      outcome: {
        status: 'ok',
        stdout: composedStdout,
        stderr: composedStderr,
        sandboxKeyCount: Object.keys(session.sandbox).length,
        producedKeys,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ok: true,
      outcome: {
        status: 'error',
        stdout: [],
        stderr: [errorMessage],
        errorMessage,
        sandboxKeyCount: Object.keys(session.sandbox).length,
        producedKeys: [],
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
  // Runner stdout/stderr entries preserve console argument boundaries. Notebook
  // output rows are line-oriented, so normalize each entry to the same joined
  // text shape as the composed console capture path and enforce the same caps.
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

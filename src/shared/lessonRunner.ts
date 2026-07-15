/**
 * RL-039 Slices B/C — Recipe assertion runner.
 *
 * Pure helpers used by the renderer-side `useRecipeRun` hook to:
 *
 *   1. Compose a language-aware source that wraps the user's tab
 *      code in a try/catch + appends an assertion shim per
 *      `AssertionV1` (`buildLessonRunSource`).
 *   2. Parse the runner's stdout for the sentinel-prefixed JSON
 *      payload each assertion emits (`parseAssertionResults`).
 *
 * No worker / IPC / DOM here — this module stays usable from the
 * upcoming CLI `lingua lesson validate` path (RL-098 Slice 2).
 *
 * The sentinel format is intentionally simple — one line per
 * assertion, prefix + JSON. The renderer's stdout sink is line-
 * oriented (see `ConsolePanel`), so the parser can stream the
 * results in order without buffering the whole output.
 *
 * Closed enums:
 *
 *   - `ASSERTION_RESULT_STATUSES` — per-assertion outcome bucket.
 *     `'pass' | 'fail' | 'thrown' | 'sentinel-missing'`. The
 *     `'sentinel-missing'` case fires when the user's code crashes
 *     before all assertions could emit their line, so the panel can
 *     surface a row for every declared assertion (vs silently
 *     dropping the missing ones).
 *   - `RECIPE_RUN_STATUSES` — run-level rollup used by the
 *     `recipe.test_run` telemetry event (fold B). Mirrored on
 *     update-server with parity test.
 *
 * Privacy posture:
 *
 *   - The composed source NEVER reads from the user's filesystem,
 *     network, or clipboard.
 *   - Assertion `code` strings come from the bundled catalog —
 *     Slices B/C have zero user-authored recipes. A later import slice will
 *     route through `parseLessonPack` which caps `code` length.
 */

import {
  type AssertionExitKind,
  type AssertionV1,
} from './lessonPack';
import type { LanguagePackId } from './languagePacks';

// ---------------------------------------------------------------------------
// Sentinel — SINGLE source of truth. Renderer + parser BOTH import.
// ---------------------------------------------------------------------------

/**
 * Prefix every assertion-result line carries. The double-bracket
 * shape mirrors the RL-044 / Pyodide payload conventions so a future
 * rich-output integration can reuse the existing line-classifier.
 *
 * Collision probability with user code is negligible — even if a
 * user logs the exact literal, the parser asserts the JSON payload
 * declares a known `assertionId` for the current recipe (rejecting
 * unknown ids silently), so the worst case is one dropped spurious
 * row, not a crash.
 */
export const ASSERTION_RESULT_SENTINEL = '[[lingua-recipe:result]]';

// ---------------------------------------------------------------------------
// Closed enums
// ---------------------------------------------------------------------------

export const ASSERTION_RESULT_STATUSES = [
  'pass',
  'fail',
  'thrown',
  'sentinel-missing',
] as const;
export type AssertionResultStatus = (typeof ASSERTION_RESULT_STATUSES)[number];

export const RECIPE_RUN_STATUSES = [
  'all-passed',
  'some-failed',
  'all-failed',
  'execution-error',
  'sentinel-missing',
] as const;
export type RecipeRunStatus = (typeof RECIPE_RUN_STATUSES)[number];

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface AssertionRunResult {
  readonly assertionId: string;
  readonly status: AssertionResultStatus;
  /** Optional short detail string (fold C) — failed/thrown assertions surface why. Cap ~200 chars. */
  readonly details?: string;
}

/** Hard cap for the `details` field so a runaway error message doesn't bloat the row. */
export const MAX_ASSERTION_DETAIL_LENGTH = 200;

// ---------------------------------------------------------------------------
// Source composition
// ---------------------------------------------------------------------------

/**
 * Build the source that runs the user's code and then iterates
 * `assertions`, emitting one sentinel-prefixed JSON line per result.
 * JavaScript and TypeScript share the JS-family composer (the TS runner
 * strips types before handing the program to the JS worker); Python gets
 * an equivalent native composer so its assertions execute in the same
 * module scope as the user's declarations.
 *
 * Contract:
 *
 *   - The user's code runs first, fully, inside the same block as
 *     the assertions — so top-level `const` / `let` / `function`
 *     declarations are visible to the direct `eval()` calls that
 *     follow.
 *   - If the user's code throws synchronously, the assertion shim
 *     CATCHES the error, emits a single `__lingua_recipe_user_throw`
 *     marker, then runs each assertion as `'sentinel-missing'` so
 *     the panel can show every row.
 *   - Assertion code strings are interpolated with `JSON.stringify`
 *     so quotes / newlines stay intact. The resulting source is
 *     pure ASCII + UTF-8-safe.
 *   - The function returns an `(async () => { ... })()` promise so
 *     the JS worker does not emit `done` until every assertion
 *     sentinel has been printed.
 *
 * The composed source is ~1 KB even for 10 assertions; well under
 * the worker's per-run budget.
 *
 * **Why this composed source uses `eval()` for the assertion body —
 * intentional + audited.** Each assertion's `code` field is a JS
 * expression (kind `'value'` / `'throw'`) that must execute in the
 * SAME lexical scope as the user's tab code so a declared
 * `const result = solve(input)` is visible to the assertion `result
 * === expected`. There is no safer alternative: JSON.parse can't run
 * expressions, and a sandbox AST evaluator would have to be Turing-
 * complete to handle the assertions we want to author (and would
 * defeat the point — the user's code is already running unsandboxed
 * via the same JS worker pipeline that ships every Lingua run).
 * The security posture is inherited from the JS worker:
 *   1. Slice B assertions come exclusively from the bundled,
 *      type-checked catalog under `src/renderer/data/recipes/*.ts`
 *      — zero user-authored recipes Slice B.
 *   2. `parseLessonPack` (used by Slice C+ import + the upcoming
 *      `lingua lesson validate` CLI) caps `code` length at
 *      `MAX_ASSERTION_CODE_LENGTH = 2 000 chars` and asserts the
 *      `kind` discriminant before any source ever reaches this
 *      function.
 *   3. The composed source runs inside the existing JS worker which
 *      already enforces RL-020 Slice 7 timeout presets + RL-077 /
 *      RL-078 hardening (no access to renderer DOM, IPC bridge, or
 *      `window.lingua.*`).
 * Replacing `eval` with `new Function(code)` would carry identical
 * risk surface while losing access to the IIFE-scoped user
 * declarations — not a meaningful improvement.
 */
export function buildLessonRunSource(
  language: RecipeRunnableLanguage,
  userCode: string,
  assertions: ReadonlyArray<AssertionV1>
): string {
  if (language === 'python') {
    return buildPythonLessonRunSource(userCode, assertions);
  }
  return buildJavaScriptFamilyLessonRunSource(userCode, assertions);
}

function buildJavaScriptFamilyLessonRunSource(
  userCode: string,
  assertions: ReadonlyArray<AssertionV1>
): string {
  const assertionsJson = JSON.stringify(
    assertions.map((a) => ({ id: a.id, kind: a.kind, code: a.code }))
  );
  const sentinel = JSON.stringify(ASSERTION_RESULT_SENTINEL);
  return [
    'await (async () => {',
    '  "use strict";',
    `  const __lingua_recipe_sentinel = ${sentinel};`,
    `  const __lingua_recipe_assertions = ${assertionsJson};`,
    '  const __lingua_recipe_console_buffer = [];',
    '  const __lingua_recipe_original_log = console.log.bind(console);',
    '  const __lingua_recipe_capture_log = (...args) => {',
    '    try {',
    '      const text = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");',
    '      __lingua_recipe_console_buffer.push(text);',
    '    } catch { /* ignore stringify error */ }',
    '    __lingua_recipe_original_log(...args);',
    '  };',
    '  console.log = __lingua_recipe_capture_log;',
    '  let __lingua_recipe_user_error = null;',
    '  const __lingua_recipe_emit = (assertionId, status, details) => {',
    '    const payload = details !== undefined ? { assertionId, status, details } : { assertionId, status };',
    '    __lingua_recipe_original_log(__lingua_recipe_sentinel + JSON.stringify(payload));',
    '  };',
    '  const __lingua_recipe_clip = (text) => {',
    '    if (typeof text !== "string") return String(text);',
    `    return text.length > ${MAX_ASSERTION_DETAIL_LENGTH} ? text.slice(0, ${MAX_ASSERTION_DETAIL_LENGTH - 1}) + "…" : text;`,
    '  };',
    '  try {',
    '    try {',
    userCode,
    '      for (const assertion of __lingua_recipe_assertions) {',
    '        try {',
    '          if (assertion.kind === "throw") {',
    '            let threw = false;',
    '            try { await eval(assertion.code); }',
    '            catch { threw = true; }',
    '            if (threw) {',
    '              __lingua_recipe_emit(assertion.id, "pass");',
    '            } else {',
    '              __lingua_recipe_emit(assertion.id, "fail", "expected the snippet to throw");',
    '            }',
    '          } else if (assertion.kind === "console-contains") {',
    '            const joined = __lingua_recipe_console_buffer.join("\\n");',
    '            if (joined.includes(assertion.code)) {',
    '              __lingua_recipe_emit(assertion.id, "pass");',
    '            } else {',
    '              __lingua_recipe_emit(assertion.id, "fail", __lingua_recipe_clip("stdout did not contain: " + assertion.code));',
    '            }',
    '          } else {',
    '            const result = await eval(assertion.code);',
    '            if (Boolean(result)) {',
    '              __lingua_recipe_emit(assertion.id, "pass");',
    '            } else {',
    '              __lingua_recipe_emit(assertion.id, "fail", __lingua_recipe_clip("assertion returned: " + (() => { try { return JSON.stringify(result); } catch { return String(result); } })()));',
    '            }',
    '          }',
    '        } catch (err) {',
    '          __lingua_recipe_emit(assertion.id, "thrown", __lingua_recipe_clip(err instanceof Error ? err.message : String(err)));',
    '        }',
    '      }',
    '    } catch (err) {',
    '      __lingua_recipe_user_error = err;',
    '    }',
    '    if (__lingua_recipe_user_error !== null) {',
    '      for (const assertion of __lingua_recipe_assertions) {',
    '        __lingua_recipe_emit(assertion.id, "sentinel-missing", __lingua_recipe_clip(',
    '          __lingua_recipe_user_error instanceof Error',
    '            ? __lingua_recipe_user_error.message',
    '            : String(__lingua_recipe_user_error)',
    '        ));',
    '      }',
    '    }',
    '  } finally {',
    '    console.log = __lingua_recipe_original_log;',
    '  }',
    '})();',
  ].join('\n');
}

/**
 * Compose the Python equivalent of the JS-family assertion shim.
 *
 * Python's `try` blocks do not introduce a lexical scope, so definitions
 * from the indented user source remain visible to `eval(..., globals(),
 * globals())`. The worker-installed `print` function is wrapped (rather
 * than `sys.stdout`) so normal user output still reaches Lingua while the
 * console-contains assertion kind gets a private text buffer. The wrapper
 * is restored in `finally`, including user-code and assertion failures.
 */
function buildPythonLessonRunSource(
  userCode: string,
  assertions: ReadonlyArray<AssertionV1>
): string {
  const assertionsJson = JSON.stringify(
    assertions.map((a) => ({ id: a.id, kind: a.kind, code: a.code }))
  );
  const assertionsLiteral = JSON.stringify(assertionsJson);
  const sentinelLiteral = JSON.stringify(ASSERTION_RESULT_SENTINEL);
  const indentedUserCode = indentPythonBlock(userCode, 4);

  return [
    'import json as __lingua_recipe_json',
    '',
    `__lingua_recipe_sentinel = ${sentinelLiteral}`,
    `__lingua_recipe_assertions = __lingua_recipe_json.loads(${assertionsLiteral})`,
    '__lingua_recipe_console_buffer = []',
    '__lingua_recipe_original_print = print',
    '',
    'def __lingua_recipe_capture_print(*args, **kwargs):',
    '    sep = kwargs.get("sep", " ")',
    '    end = kwargs.get("end", "\\n")',
    '    if sep is None:',
    '        sep = " "',
    '    if end is None:',
    '        end = "\\n"',
    '    try:',
    '        __lingua_recipe_console_buffer.append(sep.join(str(arg) for arg in args) + end)',
    '    except BaseException:',
    '        pass',
    '    __lingua_recipe_original_print(*args, **kwargs)',
    '',
    'def __lingua_recipe_clip(value):',
    '    text = str(value)',
    `    return text[:${MAX_ASSERTION_DETAIL_LENGTH - 1}] + "…" if len(text) > ${MAX_ASSERTION_DETAIL_LENGTH} else text`,
    '',
    'def __lingua_recipe_emit(assertion_id, status, details=None):',
    '    payload = {"assertionId": assertion_id, "status": status}',
    '    if details is not None:',
    '        payload["details"] = __lingua_recipe_clip(details)',
    '    __lingua_recipe_original_print(',
    '        __lingua_recipe_sentinel + __lingua_recipe_json.dumps(payload, ensure_ascii=False)',
    '    )',
    '',
    'globals()["print"] = __lingua_recipe_capture_print',
    '__lingua_recipe_user_error = None',
    'try:',
    '    try:',
    indentPythonBlock(indentedUserCode, 4),
    '    except BaseException as error:',
    '        __lingua_recipe_user_error = error',
    '',
    '    if __lingua_recipe_user_error is None:',
    '        for assertion in __lingua_recipe_assertions:',
    '            try:',
    '                kind = assertion["kind"]',
    '                code = assertion["code"]',
    '                if kind == "throw":',
    '                    threw = False',
    '                    try:',
    '                        eval(code, globals(), globals())',
    '                    except BaseException:',
    '                        threw = True',
    '                    if threw:',
    '                        __lingua_recipe_emit(assertion["id"], "pass")',
    '                    else:',
    '                        __lingua_recipe_emit(assertion["id"], "fail", "expected the snippet to throw")',
    '                elif kind == "console-contains":',
    '                    joined = "".join(__lingua_recipe_console_buffer)',
    '                    if code in joined:',
    '                        __lingua_recipe_emit(assertion["id"], "pass")',
    '                    else:',
    '                        __lingua_recipe_emit(assertion["id"], "fail", "stdout did not contain: " + code)',
    '                else:',
    '                    result = eval(code, globals(), globals())',
    '                    if bool(result):',
    '                        __lingua_recipe_emit(assertion["id"], "pass")',
    '                    else:',
    '                        __lingua_recipe_emit(assertion["id"], "fail", "assertion returned: " + repr(result))',
    '            except BaseException as error:',
    '                __lingua_recipe_emit(assertion["id"], "thrown", error)',
    '    else:',
    '        for assertion in __lingua_recipe_assertions:',
    '            __lingua_recipe_emit(assertion["id"], "sentinel-missing", __lingua_recipe_user_error)',
    'finally:',
    '    globals()["print"] = __lingua_recipe_original_print',
  ].join('\n');
}

function indentPythonBlock(source: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  const body = source.length > 0 ? source : 'pass';
  return body
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Stdout parsing
// ---------------------------------------------------------------------------

/**
 * Parse the runner's combined stdout for sentinel-prefixed lines.
 * Returns one `AssertionRunResult` per known assertion id — missing
 * assertions are filled in with `'sentinel-missing'` so the renderer
 * can always show one row per declared assertion (vs surprising the
 * user with vanishing rows when the snippet crashes mid-flight).
 *
 * Unknown ids in the stdout (collision with user code that happened
 * to print the literal prefix) are dropped silently.
 */
export function parseAssertionResults(
  stdout: string,
  assertions: ReadonlyArray<AssertionV1>
): AssertionRunResult[] {
  const known = new Set(assertions.map((a) => a.id));
  const seen = new Map<string, AssertionRunResult>();
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(ASSERTION_RESULT_SENTINEL);
    if (idx === -1) continue;
    const payloadText = line.slice(idx + ASSERTION_RESULT_SENTINEL.length).trim();
    if (payloadText.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.assertionId !== 'string') continue;
    if (!known.has(obj.assertionId)) continue;
    if (typeof obj.status !== 'string') continue;
    if (!(ASSERTION_RESULT_STATUSES as readonly string[]).includes(obj.status)) {
      continue;
    }
    const status = obj.status as AssertionResultStatus;
    const details =
      typeof obj.details === 'string'
        ? obj.details.length > MAX_ASSERTION_DETAIL_LENGTH
          ? `${obj.details.slice(0, MAX_ASSERTION_DETAIL_LENGTH - 1)}…`
          : obj.details
        : undefined;
    // Last write wins — the runner only emits one line per assertion
    // but defensively dedupe so a collision on the prefix doesn't
    // multiply rows.
    seen.set(obj.assertionId, {
      assertionId: obj.assertionId,
      status,
      ...(details !== undefined ? { details } : {}),
    });
  }
  const ordered: AssertionRunResult[] = [];
  for (const assertion of assertions) {
    const entry = seen.get(assertion.id);
    ordered.push(
      entry ?? { assertionId: assertion.id, status: 'sentinel-missing' }
    );
  }
  return ordered;
}

/**
 * Roll the per-assertion results up to a single closed-enum status
 * suitable for the `recipe.test_run` telemetry event (fold B). The
 * priority order is: any thrown assertion → `'execution-error'`, all
 * missing → `'sentinel-missing'`, all pass → `'all-passed'`, no pass
 * → `'all-failed'`, otherwise → `'some-failed'`.
 */
export function rollupRunStatus(
  results: ReadonlyArray<AssertionRunResult>
): RecipeRunStatus {
  if (results.length === 0) return 'sentinel-missing';
  let pass = 0;
  let thrown = 0;
  let missing = 0;
  for (const r of results) {
    switch (r.status) {
      case 'pass':
        pass += 1;
        break;
      case 'thrown':
        thrown += 1;
        break;
      case 'sentinel-missing':
        missing += 1;
        break;
      case 'fail':
        // fall-through — `fail` rows count against `pass === 0` and
        // `pass === results.length`, no dedicated counter needed.
        break;
    }
  }
  if (thrown > 0) return 'execution-error';
  if (missing === results.length) return 'sentinel-missing';
  if (pass === results.length) return 'all-passed';
  if (pass === 0) return 'all-failed';
  return 'some-failed';
}

/** Convenience — true when every assertion in the result list passed. */
export function isAllPassed(results: ReadonlyArray<AssertionRunResult>): boolean {
  return results.length > 0 && results.every((r) => r.status === 'pass');
}

/**
 * Closed-enum bucket of supported recipe languages. Keep the tuple as
 * the iterable catalog source and the Set as the hot-path membership
 * guard used by the run panel.
 */
export const RECIPE_RUNNABLE_LANGUAGE_IDS = [
  'javascript',
  'typescript',
  'python',
] as const satisfies ReadonlyArray<LanguagePackId>;

export type RecipeRunnableLanguage =
  (typeof RECIPE_RUNNABLE_LANGUAGE_IDS)[number];

export const RECIPE_RUNNABLE_LANGUAGES: ReadonlySet<string> = new Set(
  RECIPE_RUNNABLE_LANGUAGE_IDS
);

export function isRecipeRunnableLanguage(
  language: string
): language is RecipeRunnableLanguage {
  return RECIPE_RUNNABLE_LANGUAGES.has(language);
}

/**
 * Compose the assertion kind discriminant for tests / docs. Kept as a
 * named export so a future Slice can widen the kinds without rebroad-
 * casting the import surface.
 */
export type { AssertionExitKind };

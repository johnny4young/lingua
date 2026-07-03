/**
 * RL-043 Slice A — runner-owned session manager coverage.
 *
 * Tests the pure helpers (`composeNotebookCellSource`,
 * `rewriteTopLevelDeclarationsForSession`, `extractSerializableDelta`)
 * + the manager via a stubbed `runnerManager.execute`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockResetScope = vi.fn();
vi.mock('../../../src/renderer/runners', () => {
  return {
    runnerManager: {
      execute: vi.fn(),
      stop: vi.fn(),
      // T17 — the session reaches the Python runner to reset a notebook's
      // kernel scope on dispose / restart.
      getPythonRunner: vi.fn(() => ({ resetScope: mockResetScope })),
    },
  };
});

import {
  composeNotebookCellSource,
  disposeNotebookSession,
  extractSerializableDelta,
  getNotebookSessionKeys,
  getNotebookSessionSnapshotForTests,
  isNotebookRunnableLanguage,
  MAX_NOTEBOOK_SANDBOX_KEYS,
  NOTEBOOK_CELL_STATUSES,
  resetNotebookSessionsForTests,
  rewriteTopLevelDeclarationsForSession,
  runNotebookCell,
  transpileTypescriptCell,
} from '../../../src/renderer/runtime/notebookSession';
import { runnerManager } from '../../../src/renderer/runners';
import type { NotebookCellLanguage } from '../../../src/shared/notebook';
import * as ts from 'typescript';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;

/**
 * Count parser-level syntax errors in a source string. `parseDiagnostics`
 * is the parser's own syntax-error list — not in the public typings, but
 * the canonical way TS tooling reads parse errors. Used by the fold-B
 * round-trip guard to assert the rewriter introduces no new syntax error.
 */
function syntaxErrorCount(source: string): number {
  const sf = ts.createSourceFile(
    'guard.js',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS
  );
  return (sf as unknown as { parseDiagnostics: ReadonlyArray<unknown> })
    .parseDiagnostics.length;
}

async function executeComposedNotebookSource(
  source: string
): Promise<{ sessionDelta: unknown }> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
    new (body: string) => () => Promise<{ sessionDelta: unknown }>;
  const fn = new AsyncFunction(await composeNotebookCellSource(source, {}));
  return fn();
}

describe('notebookSession closed enums', () => {
  it('NOTEBOOK_CELL_STATUSES stays the canonical tuple', () => {
    expect([...NOTEBOOK_CELL_STATUSES].sort()).toEqual(
      ['error', 'ok', 'stopped'].sort()
    );
  });

  it('isNotebookRunnableLanguage runs JS + TS + Python (Slice F)', () => {
    expect(isNotebookRunnableLanguage('javascript')).toBe(true);
    // RL-043 Slice C — TypeScript is type-stripped + run through the JS pipeline.
    expect(isNotebookRunnableLanguage('typescript')).toBe(true);
    // RL-043 Slice F — Python runs independently through the Python runner.
    expect(isNotebookRunnableLanguage('python')).toBe(true);
  });
});

describe('rewriteTopLevelDeclarationsForSession', () => {
  it('captures top-level `const` assignments into _sessionDelta', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('const x = 1;');
    expect(out).toContain('_sessionDelta.x = x');
  });

  it('captures top-level `let` assignments', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('let y = 2;');
    expect(out).toContain('_sessionDelta.y = y');
  });

  it('captures top-level function declarations', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('function foo() { return 1; }');
    expect(out).toContain('_sessionDelta.foo = foo');
  });

  it('captures top-level async function declarations', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('async function bar() { return 1; }');
    expect(out).toContain('_sessionDelta.bar = bar');
  });

  it('captures top-level `var` declarations', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('var v = 3;');
    expect(out).toContain('_sessionDelta.v = v');
  });

  it('captures multi-line declarations (RL-043 Slice B — was skipped)', async () => {
    const src = 'const obj = {\n  a: 1,\n};';
    const out = await rewriteTopLevelDeclarationsForSession(src);
    expect(out).toContain('_sessionDelta.obj = obj');
    // The injection lands AFTER the full declaration, not mid-literal.
    expect(out).not.toContain('_sessionDelta.obj = obj;\n  a:');
  });

  it('captures `class` declarations (RL-043 Slice B — was skipped)', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('class Greeter { hi() { return 1; } }');
    expect(out).toContain('_sessionDelta.Greeter = Greeter');
  });

  it('captures object destructuring incl. renamed + rest (RL-043 Slice B)', async () => {
    const out = await rewriteTopLevelDeclarationsForSession(
      'const { a, b: c, ...rest } = obj;'
    );
    expect(out).toContain('_sessionDelta.a = a');
    expect(out).toContain('_sessionDelta.c = c'); // renamed binding, not `b`
    expect(out).not.toContain('_sessionDelta.b = b');
    expect(out).toContain('_sessionDelta.rest = rest');
  });

  it('captures array destructuring and skips holes (RL-043 Slice B)', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('const [x, , y] = arr;');
    expect(out).toContain('_sessionDelta.x = x');
    expect(out).toContain('_sessionDelta.y = y');
  });

  it('captures multiple declarators in one statement', async () => {
    const out = await rewriteTopLevelDeclarationsForSession('let p = 1, q = 2;');
    expect(out).toContain('_sessionDelta.p = p');
    expect(out).toContain('_sessionDelta.q = q');
  });

  it('leaves declarations nested inside a block local', async () => {
    // A real nested decl (inside an `if` block) is NOT a top-level
    // statement, so it is never hoisted — unlike the Slice A regex,
    // which used a crude column-zero proxy.
    const out = await rewriteTopLevelDeclarationsForSession(
      'if (true) {\n  const nested = 1;\n}'
    );
    expect(out).not.toContain('_sessionDelta.nested');
  });

  it('hoists an indented top-level declaration (AST, not column-zero)', async () => {
    // Leading whitespace is trivia; this is still a top-level statement.
    const out = await rewriteTopLevelDeclarationsForSession('  const indented = 1;');
    expect(out).toContain('_sessionDelta.indented = indented');
  });

  it('returns the source unchanged when there are no top-level declarations', async () => {
    const src = 'console.log(1 + 2);';
    expect(await rewriteTopLevelDeclarationsForSession(src)).toBe(src);
  });

  it('returns parse-broken input unchanged instead of splicing into a recovery tree', async () => {
    const src = 'const broken = {';
    expect(await rewriteTopLevelDeclarationsForSession(src)).toBe(src);
  });

  // Fold B — the injection must never corrupt the source: the rewriter
  // introduces no NEW syntax error vs the input (re-parsed with the TS
  // parser). Guards against a future regression that splices a broken
  // assignment mid-expression.
  it('introduces no new syntax errors for every shape (fold B)', async () => {
    const inputs = [
      'const x = 1;',
      'const { a, b: c, ...rest } = obj;',
      'const [x, , y] = arr;',
      'const obj = {\n  a: 1,\n};',
      'class Greeter { hi() { return 1; } }',
      'function foo() { return 1; }',
      'let p = 1, q = 2;',
      'var v = 3;',
      'console.log(1);',
    ];
    for (const input of inputs) {
      const rewritten = await rewriteTopLevelDeclarationsForSession(input);
      expect(syntaxErrorCount(rewritten), input).toBe(syntaxErrorCount(input));
    }
  });

  // Fold E — a destructuring default with a side effect must run once.
  // The hoist reads the BOUND name (`a`), never re-invokes the default,
  // so the delta capture has no double-evaluation hazard.
  it('hoists a destructuring default by binding name, not re-eval (fold E)', async () => {
    const out = await rewriteTopLevelDeclarationsForSession(
      'const { a = sideEffect() } = obj;'
    );
    expect(out).toContain('_sessionDelta.a = a');
    // The default expression is never duplicated into the capture.
    expect(out).not.toContain('_sessionDelta.a = sideEffect()');
    expect(out.match(/sideEffect\(\)/gu) ?? []).toHaveLength(1);
  });
});

describe('composeNotebookCellSource', () => {
  it('emits pull-in `const KEY = <JSON>;` lines for every sandbox key', async () => {
    const composed = await composeNotebookCellSource('console.log(x);', {
      x: 21,
    });
    expect(composed).toContain('const x = 21;');
  });

  it('skips sandbox keys that are not valid identifiers', async () => {
    const composed = await composeNotebookCellSource('console.log(1);', {
      'not valid': 1,
      ok: 2,
    });
    expect(composed).toContain('const ok = 2;');
    expect(composed).not.toContain("'not valid'");
  });

  it('wraps the user source in an async IIFE that returns sessionDelta', async () => {
    const composed = await composeNotebookCellSource('const x = 1;', {});
    expect(composed).toContain('(async () =>');
    expect(composed).toContain('return { stdout');
    expect(composed).toContain('sessionDelta: _sessionDelta');
  });

  it('truncates pull-ins after MAX_NOTEBOOK_SANDBOX_KEYS keys', async () => {
    const sandbox: Record<string, number> = {};
    for (let i = 0; i < MAX_NOTEBOOK_SANDBOX_KEYS + 10; i += 1) {
      sandbox[`k${i}`] = i;
    }
    const composed = await composeNotebookCellSource('void 0;', sandbox);
    expect(composed).not.toContain(`const k${MAX_NOTEBOOK_SANDBOX_KEYS + 1} =`);
  });

  it('re-running a cell that re-declares a sandbox key does not throw (regression)', async () => {
    // First run put `x` in the sandbox; the second run of the SAME cell
    // must not inject `const x = 1;` next to the user's `let x = 1` —
    // that was a guaranteed `Identifier 'x' has already been declared`
    // on every second Run.
    const source = 'let x = 1;';
    const composed = await composeNotebookCellSource(source, { x: 1 });
    expect(composed).not.toContain('const x = 1;');
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (body: string) => () => Promise<{
      sessionDelta: Record<string, unknown>;
    }>;
    const result = await new AsyncFunction(composed)();
    expect(result.sessionDelta).toMatchObject({ x: 1 });
  });

  it('a later cell re-declaring a sandbox name shadows the pull-in instead of throwing', async () => {
    const composed = await composeNotebookCellSource('const y = 2;', {
      y: 1,
      z: 3,
    });
    // `y` is declared by the cell → no pull-in; `z` still flows in.
    expect(composed).not.toContain('const y = 1;');
    expect(composed).toContain('const z = 3;');
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (body: string) => () => Promise<{
      sessionDelta: Record<string, unknown>;
    }>;
    const result = await new AsyncFunction(composed)();
    expect(result.sessionDelta).toMatchObject({ y: 2 });
  });

  it('skips pull-ins for cell-declared functions, classes, and destructured bindings', async () => {
    const source = [
      'function fn() { return 1; }',
      'class Klass {}',
      'const { a, ...rest } = { a: 1, b: 2 };',
      'let pending;',
    ].join('\n');
    const composed = await composeNotebookCellSource(source, {
      fn: 'stale',
      Klass: 'stale',
      a: 'stale',
      rest: 'stale',
      pending: 'stale',
      keep: 'fresh',
    });
    expect(composed).not.toContain('const fn = "stale";');
    expect(composed).not.toContain('const Klass = "stale";');
    expect(composed).not.toContain('const a = "stale";');
    expect(composed).not.toContain('const rest = "stale";');
    expect(composed).not.toContain('const pending = "stale";');
    expect(composed).toContain('const keep = "fresh";');
  });
});

describe('transpileTypescriptCell (RL-043 Slice C)', () => {
  it('type-strips a typed declaration to runnable JavaScript', async () => {
    const result = await transpileTypescriptCell('const x: number = 41 + 1;');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.js).toContain('const x = 41 + 1');
    expect(result.js).not.toContain(': number');
  });

  it('erases type-only constructs (interface / type) to nothing runnable', async () => {
    const result = await transpileTypescriptCell(
      'interface Point { x: number }\ntype Id = string;\nconst n = 1;'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.js).not.toContain('interface');
    expect(result.js).not.toContain('type Id');
    expect(result.js).toContain('const n = 1');
  });

  it('erases type-only imports/exports without emitting a runtime module marker', async () => {
    const result = await transpileTypescriptCell(
      'import type { Foo } from "./types";\nexport type Bar = Foo;\nconst n: number = 1;'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.js).toContain('const n = 1');
    expect(result.js).not.toContain('import type');
    expect(result.js).not.toContain('export type');
    expect(result.js).not.toContain('export {}');
  });

  it('fold F — emits a serializable runtime value for `enum` so it crosses cells', async () => {
    const result = await transpileTypescriptCell('enum Color { Red, Green }');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // enum lowers to a `var Color` IIFE — a plain object the rewriter
    // captures + the JSON sandbox round-trips after the IIFE initializes it.
    expect(result.js).toContain('var Color');
    const executed = await executeComposedNotebookSource(result.js);
    const safe = extractSerializableDelta(executed.sessionDelta);
    expect(safe.Color).toMatchObject({ Red: 0, Green: 1 });
  });

  it('fold F — lowers a `namespace` to a captured object', async () => {
    const result = await transpileTypescriptCell(
      'namespace NS { export const v = 1; }'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const executed = await executeComposedNotebookSource(result.js);
    const safe = extractSerializableDelta(executed.sessionDelta);
    expect(safe.NS).toMatchObject({ v: 1 });
  });

  it('fold B — surfaces a syntax error with a 1-based line:col position', async () => {
    const result = await transpileTypescriptCell('const y: number = ;');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('TypeScript:');
    // The position suffix points at the offending line:col (1-based).
    expect(result.message).toMatch(/\(1:\d+\)/);
  });
});

describe('extractSerializableDelta', () => {
  it('keeps primitives, plain objects, and arrays', () => {
    const safe = extractSerializableDelta({
      a: 1,
      b: 'x',
      c: [1, 2, 3],
      d: { nested: true },
    });
    expect(safe).toEqual({
      a: 1,
      b: 'x',
      c: [1, 2, 3],
      d: { nested: true },
    });
  });

  it('drops functions, retains primitives next to non-serializable neighbors', () => {
    const raw = {
      keep: 1,
      fn: () => 1,
      sym: Symbol('s'),
    };
    const safe = extractSerializableDelta(raw);
    expect(safe.keep).toBe(1);
    expect(safe.fn).toBeUndefined();
    expect(safe.sym).toBeUndefined();
  });

  it('returns {} for non-object inputs', () => {
    expect(extractSerializableDelta(null)).toEqual({});
    expect(extractSerializableDelta('string')).toEqual({});
    expect(extractSerializableDelta([1, 2, 3])).toEqual({});
  });
});

describe('runNotebookCell + session manager', () => {
  beforeEach(() => {
    resetNotebookSessionsForTests();
    mockExecute.mockReset();
  });
  afterEach(() => {
    resetNotebookSessionsForTests();
  });

  it('rejects a non-code-cell language with `language-not-supported`', async () => {
    const result = await runNotebookCell({
      tabId: 'tab-1',
      // All three real code-cell languages (JS / TS / Python) now run, so
      // the reject path is exercised with an out-of-enum language cast.
      language: 'ruby' as NotebookCellLanguage,
      source: 'puts 1',
    });
    expect(result).toEqual({ ok: false, reason: 'language-not-supported' });
  });

  it('runs a Python cell through the python runner, independent of the JS sandbox (Slice F)', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: 'hello',
      // Runner stdout/stderr entries preserve console-arg boundaries:
      // `{ args: string[] }` per entry (see flattenStdoutText).
      stdout: [{ args: ['hello'] }],
      stderr: [],
    });
    const result = await runNotebookCell({
      tabId: 'tab-py',
      language: 'python',
      source: 'print("hello")',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('ok');
    expect(result.outcome.stdout).toEqual(['hello']);
    // Generator/transform independence: Python never feeds the JS sandbox.
    expect(result.outcome.producedKeys).toEqual([]);
    expect(getNotebookSessionKeys('tab-py')).toEqual([]);
    // Routed to the python runner with the RAW source (no JS compose) and
    // WITHOUT the JS-only structured-result channel.
    expect(mockExecute.mock.calls[0]?.[0]).toBe('python');
    expect(mockExecute.mock.calls[0]?.[1]).toBe('print("hello")');
    // T17 — the cell runs against a per-notebook kernel scope keyed by tabId.
    expect(mockExecute.mock.calls[0]?.[2]).toMatchObject({
      language: 'python',
      scopeId: 'tab-py',
    });
    expect(mockExecute.mock.calls[0]?.[2]).not.toHaveProperty(
      'captureStructuredResult'
    );
  });

  it('T17 — disposing a notebook session resets its Python kernel scope', () => {
    mockResetScope.mockClear();
    disposeNotebookSession('tab-restart');
    expect(mockResetScope).toHaveBeenCalledWith('tab-restart');
  });

  it('surfaces a Python runtime error on the cell outcome (Slice F)', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: '',
      stdout: [],
      stderr: [{ args: ['Traceback (most recent call last):'] }],
      error: { message: "NameError: name 'x' is not defined" },
    });
    const result = await runNotebookCell({
      tabId: 'tab-py-err',
      language: 'python',
      source: 'print(x)',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('error');
    expect(result.outcome.errorMessage).toContain('NameError');
    expect(result.outcome.stderr).toContain(
      "NameError: name 'x' is not defined"
    );
  });

  it('maps a stopped Python run to a stopped outcome (Slice F)', async () => {
    // The real Python runner returns `runnerStoppedResult`: `cancelled:
    // true` WITH an `error.message` set (the "stopped" message). The
    // branch must check `cancelled` BEFORE `error.message`, so the outcome
    // is `stopped`, not `error`. Mocking the authentic shape locks that
    // precedence in (a `kind: 'stopped'` mock would not have caught it).
    mockExecute.mockResolvedValue({
      kind: 'stopped',
      result: undefined,
      stdout: [],
      stderr: [],
      cancelled: true,
      error: { message: 'Execution stopped' },
    });
    const result = await runNotebookCell({
      tabId: 'tab-py-stop',
      language: 'python',
      source: 'while True: pass',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('stopped');
    // The stop message must NOT leak onto stderr as if it were an error.
    expect(result.outcome.stderr).toEqual([]);
  });

  it('keeps Python isolated from the JS cross-cell sandbox (Slice F)', async () => {
    // A JS cell declares `x`; a later Python cell must NOT see it injected
    // and must NOT mutate the JS sandbox.
    mockExecute.mockResolvedValueOnce({
      kind: 'ok',
      result: '{ "sessionDelta": { "x": 1 } }',
      structuredResult: { stdout: [], stderr: [], sessionDelta: { x: 1 } },
      stdout: [],
      stderr: [],
    });
    await runNotebookCell({
      tabId: 'tab-mix',
      language: 'javascript',
      source: 'const x = 1;',
    });
    mockExecute.mockResolvedValueOnce({
      kind: 'ok',
      result: '',
      stdout: [{ args: ['ok'] }],
      stderr: [],
    });
    await runNotebookCell({
      tabId: 'tab-mix',
      language: 'python',
      source: 'print("ok")',
    });
    // The python run received the raw source, not a composed JS prelude
    // carrying `x`.
    const pythonSource = String(mockExecute.mock.calls[1]?.[1] ?? '');
    expect(pythonSource).toBe('print("ok")');
    // The JS sandbox still holds only `x` (python added nothing).
    expect(getNotebookSessionKeys('tab-mix')).toEqual(['x']);
  });

  it('records ok + merges sessionDelta into the per-tab sandbox', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      // Faithful worker shape (RL-043 Slice B): `result` is a truncatable
      // display STRING; the live `{ stdout, stderr, sessionDelta }` rides
      // the dedicated `structuredResult` channel. The cross-cell merge
      // reads `structuredResult` — NOT `result` — so a stale mock that
      // put the object in `result` would (and historically did) hide the
      // truncation bug.
      result: '{\n  "stdout": ["42"],\n  "stderr": [],\n  "sessionDelta": { "x": 42 }\n}',
      structuredResult: {
        stdout: ['42'],
        stderr: [],
        sessionDelta: { x: 42 },
      },
      stdout: [],
      stderr: [],
    });
    const result = await runNotebookCell({
      tabId: 'tab-ok',
      language: 'javascript',
      source: 'const x = 42; console.log(x);',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('ok');
    expect(result.outcome.stdout).toEqual(['42']);
    expect(getNotebookSessionKeys('tab-ok')).toContain('x');
    expect(getNotebookSessionSnapshotForTests('tab-ok')?.x).toBe(42);
    // The run must opt into the structured channel, else the worker
    // only sends the truncatable display string and the delta is lost.
    expect(mockExecute.mock.calls[0]?.[2]).toMatchObject({
      captureStructuredResult: true,
    });
  });

  it('does NOT merge from the display string when structuredResult is absent', async () => {
    // Regression guard for the pre-RL-043-Slice-B bug: the worker only
    // ever returned the delta inside the `result` DISPLAY STRING (which it
    // truncates at MAX_RESULT_BYTES), and the merge read it as if it were a
    // structured object — so nothing ever shared cross-cell in the real
    // app. The fix reads the dedicated `structuredResult` channel. Proving
    // a string-only `result` merges NOTHING locks that in: if a future
    // change reintroduces display-string parsing, this goes red.
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: '{\n  "sessionDelta": { "leaked": 1 }\n}',
      // structuredResult intentionally omitted (old worker shape).
      stdout: [],
      stderr: [],
    });
    const result = await runNotebookCell({
      tabId: 'tab-nostruct',
      language: 'javascript',
      source: 'const leaked = 1;',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('ok');
    expect(getNotebookSessionKeys('tab-nostruct')).toEqual([]);
  });

  it('cell 2 reads cell 1 declarations via the pull-in step', async () => {
    mockExecute
      .mockResolvedValueOnce({
        kind: 'ok',
        result: '{ "sessionDelta": { "secret": 7 } }',
        structuredResult: { stdout: [], stderr: [], sessionDelta: { secret: 7 } },
        stdout: [],
        stderr: [],
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        result: '{ "stdout": ["7"] }',
        structuredResult: { stdout: ['7'], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
    await runNotebookCell({
      tabId: 'tab-chain',
      language: 'javascript',
      source: 'const secret = 7;',
    });
    await runNotebookCell({
      tabId: 'tab-chain',
      language: 'javascript',
      source: 'console.log(secret);',
    });
    const composedForSecond = String(mockExecute.mock.calls[1]?.[1] ?? '');
    expect(composedForSecond).toContain('const secret = 7;');
  });

  it('type-strips a TypeScript cell before the runner + merges its delta', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: '{ "sessionDelta": { "n": 7 } }',
      structuredResult: { stdout: [], stderr: [], sessionDelta: { n: 7 } },
      stdout: [],
      stderr: [],
    });
    const result = await runNotebookCell({
      tabId: 'tab-ts',
      language: 'typescript',
      source: 'const n: number = 7;',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('ok');
    // The source handed to the runner is type-stripped JavaScript.
    const composed = String(mockExecute.mock.calls[0]?.[1] ?? '');
    expect(composed).not.toContain(': number');
    expect(composed).toContain('const n = 7');
    // Cross-cell delta still merges (TS rides the same structured channel).
    expect(getNotebookSessionKeys('tab-ts')).toContain('n');
  });

  it('surfaces a TypeScript syntax error as an error outcome, never reaching the runner', async () => {
    mockExecute.mockClear();
    const result = await runNotebookCell({
      tabId: 'tab-ts-err',
      language: 'typescript',
      source: 'const broken: number = ;',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('error');
    expect(result.outcome.errorMessage).toContain('TypeScript:');
    // A transpile failure short-circuits before the worker round-trip.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('records error + propagates the error message to stderr', async () => {
    mockExecute.mockResolvedValue({
      kind: 'error',
      error: { message: 'ReferenceError: ouch' },
      stdout: [],
      stderr: [],
    });
    const result = await runNotebookCell({
      tabId: 'tab-err',
      language: 'javascript',
      source: 'throw new Error("boom");',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('error');
    expect(result.outcome.stderr).toContain('ReferenceError: ouch');
  });

  it('settles to an error outcome if runner execution rejects', async () => {
    mockExecute.mockRejectedValue(new Error('Runner unavailable'));
    const result = await runNotebookCell({
      tabId: 'tab-reject',
      language: 'javascript',
      source: 'const x = 1;',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('error');
    expect(result.outcome.errorMessage).toBe('Runner unavailable');
    expect(result.outcome.stderr).toEqual(['Runner unavailable']);
    expect(getNotebookSessionKeys('tab-reject')).toEqual([]);
  });

  it('records stopped when the runner cancels mid-flight', async () => {
    mockExecute.mockResolvedValue({
      kind: 'stopped',
      cancelled: true,
      stdout: [],
      stderr: [],
    });
    const result = await runNotebookCell({
      tabId: 'tab-stop',
      language: 'javascript',
      source: 'while (true) {}',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe('stopped');
  });

  it('disposeNotebookSession drops the per-tab sandbox', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: '{ "sessionDelta": { "z": 9 } }',
      structuredResult: { stdout: [], stderr: [], sessionDelta: { z: 9 } },
      stdout: [],
      stderr: [],
    });
    await runNotebookCell({
      tabId: 'tab-dispose',
      language: 'javascript',
      source: 'const z = 9;',
    });
    expect(getNotebookSessionKeys('tab-dispose')).toContain('z');
    disposeNotebookSession('tab-dispose');
    expect(getNotebookSessionKeys('tab-dispose')).toEqual([]);
  });
});

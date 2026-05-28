/**
 * RL-043 Slice A — runner-owned session manager coverage.
 *
 * Tests the pure helpers (`composeNotebookCellSource`,
 * `rewriteTopLevelDeclarationsForSession`, `extractSerializableDelta`)
 * + the manager via a stubbed `runnerManager.execute`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/renderer/runners', () => {
  return {
    runnerManager: {
      execute: vi.fn(),
      stop: vi.fn(),
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
} from '../../../src/renderer/runtime/notebookSession';
import { runnerManager } from '../../../src/renderer/runners';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;

describe('notebookSession closed enums', () => {
  it('NOTEBOOK_CELL_STATUSES stays the canonical tuple', () => {
    expect([...NOTEBOOK_CELL_STATUSES].sort()).toEqual(
      ['error', 'ok', 'stopped'].sort()
    );
  });

  it('isNotebookRunnableLanguage gates Slice A to JavaScript only', () => {
    expect(isNotebookRunnableLanguage('javascript')).toBe(true);
    expect(isNotebookRunnableLanguage('typescript')).toBe(false);
    expect(isNotebookRunnableLanguage('python')).toBe(false);
  });
});

describe('rewriteTopLevelDeclarationsForSession', () => {
  it('captures top-level `const` assignments into _sessionDelta', () => {
    const out = rewriteTopLevelDeclarationsForSession('const x = 1;');
    expect(out).toContain('_sessionDelta.x = x');
  });

  it('captures top-level `let` assignments', () => {
    const out = rewriteTopLevelDeclarationsForSession('let y = 2;');
    expect(out).toContain('_sessionDelta.y = y');
  });

  it('captures top-level function declarations', () => {
    const out = rewriteTopLevelDeclarationsForSession('function foo() { return 1; }');
    expect(out).toContain('_sessionDelta.foo = foo');
  });

  it('captures top-level async function declarations', () => {
    const out = rewriteTopLevelDeclarationsForSession('async function bar() { return 1; }');
    expect(out).toContain('_sessionDelta.bar = bar');
  });

  it('skips indented declarations (treated as nested)', () => {
    const out = rewriteTopLevelDeclarationsForSession('  const inner = 1;');
    expect(out).not.toContain('_sessionDelta.inner');
  });

  it('skips multi-line `const obj = {` until closed by `;`', () => {
    // First line doesn't end with `;` / `)` / `]`, so the rewriter
    // SHOULD leave it alone (otherwise an assignment would emit
    // before the right-hand side is complete).
    const src = 'const obj = {\n  a: 1,\n};';
    const out = rewriteTopLevelDeclarationsForSession(src);
    expect(out).not.toContain('_sessionDelta.obj = obj;\n  a:');
  });
});

describe('composeNotebookCellSource', () => {
  it('emits pull-in `const KEY = <JSON>;` lines for every sandbox key', () => {
    const composed = composeNotebookCellSource('console.log(x);', {
      x: 21,
    });
    expect(composed).toContain('const x = 21;');
  });

  it('skips sandbox keys that are not valid identifiers', () => {
    const composed = composeNotebookCellSource('console.log(1);', {
      'not valid': 1,
      ok: 2,
    });
    expect(composed).toContain('const ok = 2;');
    expect(composed).not.toContain("'not valid'");
  });

  it('wraps the user source in an async IIFE that returns sessionDelta', () => {
    const composed = composeNotebookCellSource('const x = 1;', {});
    expect(composed).toContain('(async () =>');
    expect(composed).toContain('return { stdout');
    expect(composed).toContain('sessionDelta: _sessionDelta');
  });

  it('truncates pull-ins after MAX_NOTEBOOK_SANDBOX_KEYS keys', () => {
    const sandbox: Record<string, number> = {};
    for (let i = 0; i < MAX_NOTEBOOK_SANDBOX_KEYS + 10; i += 1) {
      sandbox[`k${i}`] = i;
    }
    const composed = composeNotebookCellSource('void 0;', sandbox);
    expect(composed).not.toContain(`const k${MAX_NOTEBOOK_SANDBOX_KEYS + 1} =`);
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

  it('rejects unsupported languages with `language-not-supported`', async () => {
    const result = await runNotebookCell({
      tabId: 'tab-1',
      language: 'python',
      source: 'print(1)',
    });
    expect(result).toEqual({ ok: false, reason: 'language-not-supported' });
  });

  it('records ok + merges sessionDelta into the per-tab sandbox', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: {
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
  });

  it('cell 2 reads cell 1 declarations via the pull-in step', async () => {
    mockExecute
      .mockResolvedValueOnce({
        kind: 'ok',
        result: { stdout: [], stderr: [], sessionDelta: { secret: 7 } },
        stdout: [],
        stderr: [],
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        result: { stdout: ['7'], stderr: [], sessionDelta: {} },
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
      result: { stdout: [], stderr: [], sessionDelta: { z: 9 } },
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

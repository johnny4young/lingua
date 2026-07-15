/**
 * RL-039 Slices B/C — `lessonRunner` tests.
 *
 * Covers:
 *   - `buildLessonRunSource` composition shape + sentinel inclusion.
 *   - `parseAssertionResults` for all four status buckets +
 *     missing-row backfill + collision rejection.
 *   - `rollupRunStatus` priority order (thrown > missing > pass > fail).
 *   - `isAllPassed` helper.
 *   - `isRecipeRunnableLanguage` JS/TS/Python gate.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ASSERTION_RESULT_SENTINEL,
  ASSERTION_RESULT_STATUSES,
  buildLessonRunSource,
  isAllPassed,
  isRecipeRunnableLanguage,
  parseAssertionResults,
  RECIPE_RUNNABLE_LANGUAGE_IDS,
  RECIPE_RUN_STATUSES,
  rollupRunStatus,
} from '../../src/shared/lessonRunner';
import type { AssertionV1 } from '../../src/shared/lessonPack';

const ASSERTIONS: AssertionV1[] = [
  { id: 'a', name: { en: 'A' }, kind: 'value', code: 'true' },
  { id: 'b', name: { en: 'B' }, kind: 'value', code: 'false' },
  { id: 'c', name: { en: 'C' }, kind: 'console-contains', code: 'hello' },
];

async function executeComposedSource(source: string): Promise<string> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    // The generated JS-family program intentionally uses top-level await:
    // esbuild accepts it for TypeScript and the worker's AsyncFunction waits
    // for every assertion sentinel before posting done.
    const AsyncFunction = Object.getPrototypeOf(async function () {
      // Type-only constructor lookup.
    }).constructor as new (body: string) => () => Promise<void>;
    const run = new AsyncFunction(source);
    const pending = run();
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  } finally {
    logSpy.mockRestore();
  }
  return lines.join('\n');
}

describe('closed enums', () => {
  it('exposes the assertion-result status surface', () => {
    expect([...ASSERTION_RESULT_STATUSES].sort()).toEqual([
      'fail',
      'pass',
      'sentinel-missing',
      'thrown',
    ]);
  });

  it('exposes the recipe-run status surface', () => {
    expect([...RECIPE_RUN_STATUSES].sort()).toEqual([
      'all-failed',
      'all-passed',
      'execution-error',
      'sentinel-missing',
      'some-failed',
    ]);
  });
});

describe('buildLessonRunSource', () => {
  it('includes the sentinel + the user code + each assertion id', () => {
    const source = buildLessonRunSource(
      'javascript',
      'const x = 1;',
      ASSERTIONS
    );
    expect(source).toContain(ASSERTION_RESULT_SENTINEL);
    expect(source).toContain('const x = 1;');
    expect(source).toContain('"a"');
    expect(source).toContain('"b"');
    expect(source).toContain('"c"');
  });

  it('wraps the body in an async IIFE', () => {
    const source = buildLessonRunSource('javascript', '', []);
    expect(source.startsWith('await (async () => {')).toBe(true);
    expect(source.trim().endsWith('})();')).toBe(true);
  });

  it('awaits the async IIFE so worker done cannot race assertion sentinels', async () => {
    const assertions: AssertionV1[] = [
      {
        id: 'first-fail',
        name: { en: 'First fail' },
        kind: 'value',
        code: 'answer === 1',
      },
      {
        id: 'second-fail',
        name: { en: 'Second fail' },
        kind: 'value',
        code: 'answer === 2',
      },
      {
        id: 'eventual-pass',
        name: { en: 'Eventual pass' },
        kind: 'value',
        code: 'answer === 0',
      },
    ];
    const source = buildLessonRunSource(
      'javascript',
      ['const answer = 0;', 'console.log("user noise");'].join('\n'),
      assertions
    );
    const stdout = await executeComposedSource(source);
    const results = parseAssertionResults(stdout, assertions);
    expect(results).toEqual([
      {
        assertionId: 'first-fail',
        status: 'fail',
        details: 'assertion returned: false',
      },
      {
        assertionId: 'second-fail',
        status: 'fail',
        details: 'assertion returned: false',
      },
      { assertionId: 'eventual-pass', status: 'pass' },
    ]);
  });

  it('runs assertions in the same lexical scope as user declarations', async () => {
    const assertions: AssertionV1[] = [
      {
        id: 'function-declaration',
        name: { en: 'Function declaration' },
        kind: 'value',
        code: 'double(21) === 42',
      },
      {
        id: 'const-binding',
        name: { en: 'Const binding' },
        kind: 'value',
        code: 'answer === 42',
      },
    ];
    const source = buildLessonRunSource(
      'javascript',
      ['const answer = 42;', 'function double(value) { return value * 2; }'].join(
        '\n'
      ),
      assertions
    );
    const stdout = await executeComposedSource(source);
    const results = parseAssertionResults(stdout, assertions);
    expect(results).toEqual([
      { assertionId: 'function-declaration', status: 'pass' },
      { assertionId: 'const-binding', status: 'pass' },
    ]);
  });

  it('uses the JS-family source for TypeScript before transpilation', () => {
    const source = buildLessonRunSource(
      'typescript',
      'const answer: number = 42;',
      ASSERTIONS
    );
    expect(source.startsWith('await (async () => {')).toBe(true);
    expect(source).toContain('const answer: number = 42;');
    expect(source).toContain(ASSERTION_RESULT_SENTINEL);
  });

  it('builds native Python source with same-scope eval + print restoration', () => {
    const source = buildLessonRunSource(
      'python',
      ['def double(value):', '    return value * 2'].join('\n'),
      [
        {
          id: 'python-value',
          name: { en: 'Python value' },
          kind: 'value',
          code: 'double(21) == 42',
        },
      ]
    );
    expect(source).toContain('        def double(value):');
    expect(source).toContain('eval(code, globals(), globals())');
    expect(source).toContain('globals()["print"] = __lingua_recipe_original_print');
    expect(source).toContain(ASSERTION_RESULT_SENTINEL);
    expect(source).not.toContain('await (async () => {');
  });
});

describe('parseAssertionResults', () => {
  it('parses one sentinel line per assertion with status pass / fail', () => {
    const stdout = [
      `${ASSERTION_RESULT_SENTINEL}${JSON.stringify({ assertionId: 'a', status: 'pass' })}`,
      `${ASSERTION_RESULT_SENTINEL}${JSON.stringify({ assertionId: 'b', status: 'fail', details: 'expected true' })}`,
      `${ASSERTION_RESULT_SENTINEL}${JSON.stringify({ assertionId: 'c', status: 'pass' })}`,
    ].join('\n');
    const results = parseAssertionResults(stdout, ASSERTIONS);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ assertionId: 'a', status: 'pass' });
    expect(results[1]?.status).toBe('fail');
    expect(results[1]?.details).toBe('expected true');
  });

  it('fills missing assertions with sentinel-missing', () => {
    const stdout = `${ASSERTION_RESULT_SENTINEL}${JSON.stringify({ assertionId: 'a', status: 'pass' })}`;
    const results = parseAssertionResults(stdout, ASSERTIONS);
    expect(results[0]?.status).toBe('pass');
    expect(results[1]?.status).toBe('sentinel-missing');
    expect(results[2]?.status).toBe('sentinel-missing');
  });

  it('drops sentinel lines with unknown assertion ids', () => {
    const stdout = `${ASSERTION_RESULT_SENTINEL}${JSON.stringify({ assertionId: 'not-a-known-id', status: 'pass' })}`;
    const results = parseAssertionResults(stdout, ASSERTIONS);
    expect(results.every((r) => r.status === 'sentinel-missing')).toBe(true);
  });

  it('ignores malformed JSON after the sentinel', () => {
    const stdout = `${ASSERTION_RESULT_SENTINEL}{not json`;
    const results = parseAssertionResults(stdout, ASSERTIONS);
    expect(results.every((r) => r.status === 'sentinel-missing')).toBe(true);
  });
});

describe('rollupRunStatus', () => {
  it('returns all-passed when every assertion passes', () => {
    expect(
      rollupRunStatus([
        { assertionId: 'a', status: 'pass' },
        { assertionId: 'b', status: 'pass' },
      ])
    ).toBe('all-passed');
  });

  it('returns all-failed when every assertion fails / misses', () => {
    expect(
      rollupRunStatus([
        { assertionId: 'a', status: 'fail' },
        { assertionId: 'b', status: 'fail' },
      ])
    ).toBe('all-failed');
  });

  it('returns some-failed for mixed pass / fail', () => {
    expect(
      rollupRunStatus([
        { assertionId: 'a', status: 'pass' },
        { assertionId: 'b', status: 'fail' },
      ])
    ).toBe('some-failed');
  });

  it('returns execution-error when any assertion threw', () => {
    expect(
      rollupRunStatus([
        { assertionId: 'a', status: 'pass' },
        { assertionId: 'b', status: 'thrown', details: 'TypeError' },
      ])
    ).toBe('execution-error');
  });

  it('returns sentinel-missing when every assertion is missing', () => {
    expect(
      rollupRunStatus([
        { assertionId: 'a', status: 'sentinel-missing' },
        { assertionId: 'b', status: 'sentinel-missing' },
      ])
    ).toBe('sentinel-missing');
  });
});

describe('isAllPassed', () => {
  it('returns true only when every result is pass', () => {
    expect(isAllPassed([{ assertionId: 'a', status: 'pass' }])).toBe(true);
    expect(isAllPassed([])).toBe(false);
    expect(
      isAllPassed([
        { assertionId: 'a', status: 'pass' },
        { assertionId: 'b', status: 'fail' },
      ])
    ).toBe(false);
  });
});

describe('isRecipeRunnableLanguage', () => {
  it('exposes the exact runnable recipe language tuple', () => {
    expect(RECIPE_RUNNABLE_LANGUAGE_IDS).toEqual([
      'javascript',
      'typescript',
      'python',
    ]);
  });

  it('allows JavaScript, TypeScript, and Python', () => {
    expect(isRecipeRunnableLanguage('javascript')).toBe(true);
    expect(isRecipeRunnableLanguage('typescript')).toBe(true);
    expect(isRecipeRunnableLanguage('python')).toBe(true);
  });

  it('blocks unsupported recipe languages', () => {
    expect(isRecipeRunnableLanguage('go')).toBe(false);
  });
});

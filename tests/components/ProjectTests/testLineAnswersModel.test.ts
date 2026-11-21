import { describe, expect, it } from 'vitest';
import { suiteTally, testLineAnswers } from '../../../src/renderer/components/ProjectTests/testLineAnswersModel';
import type { ProjectTestDisplayCase } from '../../../src/renderer/stores/projectTestStore';

const source = [
  "import { describe, it, expect } from 'vitest';",
  '',
  "describe('cart', () => {",
  "  describe.concurrent(\"totals\", () => {",
  "    it('adds line totals', () => {",
  '      expect(1).toBe(1);',
  '    });',
  '  });',
  "  it('ships free over 40', () => {",
  '    expect(shipping(41.4)).toBe(0);',
  '  });',
  "  it.skip('rounds', () => {});",
  '});',
].join('\n');

const cases: ProjectTestDisplayCase[] = [
  { file: 'cart.test.ts', path: ['cart', 'totals', 'adds line totals'], status: 'passed', durationMs: 2, declarationLine: 5 },
  {
    file: 'cart.test.ts',
    path: ['cart', 'ships free over 40'],
    status: 'failed',
    declarationLine: 9,
    failureFile: 'cart.test.ts',
    failureLine: 10,
    expected: '0',
    received: '4.9',
  },
  { file: 'cart.test.ts', path: ['cart', 'rounds'], status: 'skipped', declarationLine: 12 },
  { file: 'other.test.ts', path: ['other', 'works'], status: 'passed', declarationLine: 3 },
];

describe('testLineAnswers', () => {
  it('answers test, suite and assertion lines of the open file in line order', () => {
    const answers = testLineAnswers(cases, 'cart.test.ts', source, { suites: true });
    expect(answers.map(answer => [answer.kind, answer.line])).toEqual([
      ['suite', 3],
      ['suite', 4],
      ['test', 5],
      ['test', 9],
      ['assertion', 10],
      ['test', 12],
    ]);
    const outer = answers[0];
    expect(outer?.kind === 'suite' && suiteTally(outer.statuses)).toEqual({ passed: 1, total: 2 });
  });

  it('skips suites when the runner does not write them as describe calls', () => {
    const answers = testLineAnswers(cases, 'cart.test.ts', source, { suites: false });
    expect(answers.some(answer => answer.kind === 'suite')).toBe(false);
  });

  it('lets the assertion win a shared line and ignores history, file failures and lines past the end', () => {
    const answers = testLineAnswers(
      [
        { file: 'a.test.ts', path: ['one'], status: 'failed', declarationLine: 1, failureFile: 'a.test.ts', failureLine: 1 },
        { file: 'a.test.ts', path: ['two'], status: 'passed', declarationLine: 2, stale: true },
        { file: 'a.test.ts', path: [], status: 'failed', runnable: false, failureFile: 'a.test.ts', failureLine: 2 },
        { file: 'a.test.ts', path: ['three'], status: 'passed', declarationLine: 99 },
      ],
      'a.test.ts',
      "it('one', () => expect(1).toBe(2));\nit('two', () => {});",
      { suites: true }
    );
    expect(answers.map(answer => [answer.kind, answer.line])).toEqual([['assertion', 1]]);
  });

  it('shows a failure raised in a helper on the helper file', () => {
    const helper = testLineAnswers(
      [{ file: 'a.test.ts', path: ['one'], status: 'failed', declarationLine: 1, failureFile: 'helpers.ts', failureLine: 2 }],
      'helpers.ts',
      'export const check = () => {\n  expect(1).toBe(2);\n};',
      { suites: true }
    );
    expect(helper.map(answer => [answer.kind, answer.line])).toEqual([['assertion', 2]]);
  });

  it('keeps a distinct key for tests that share a title', () => {
    const answers = testLineAnswers(
      [
        { file: 'a.test.ts', path: ['works'], status: 'passed', declarationLine: 1 },
        { file: 'a.test.ts', path: ['works'], status: 'passed', declarationLine: 2 },
      ],
      'a.test.ts',
      "it('works', () => {});\nit('works', () => {});",
      { suites: false }
    );
    expect(new Set(answers.map(answer => answer.key)).size).toBe(2);
  });

  it('returns nothing before a readable report', () => {
    expect(testLineAnswers(null, 'a.test.ts', '', { suites: true })).toEqual([]);
  });
});

describe('suiteTally', () => {
  it('leaves skipped tests out of the count', () => {
    expect(suiteTally(['passed', 'skipped', 'failed'])).toEqual({ passed: 1, total: 2 });
    expect(suiteTally(['skipped'])).toEqual({ passed: 0, total: 0 });
  });
});

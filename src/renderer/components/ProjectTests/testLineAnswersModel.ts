import type { ProjectTestCaseStatus } from '../../../shared/projectTests';
import type { ProjectTestDisplayCase } from '../../stores/projectTestStore';

export type TestLineAnswer =
  | { kind: 'suite'; line: number; key: string; statuses: ProjectTestCaseStatus[] }
  | { kind: 'test'; line: number; key: string; test: ProjectTestDisplayCase }
  | { kind: 'assertion'; line: number; key: string; test: ProjectTestDisplayCase };

const SUITE_CALL = String.raw`\b(?:describe|suite|context)(?:\.\w+)*(?:\.each\s*\([^)]*\)(?:\s*\([^)]*\))?)?\s*\(\s*`;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * The suite's `describe` line: the closest line above its first test that
 * names it. Runners report test lines only, so suites are found in the text.
 */
function suiteLine(lines: readonly string[], name: string, before: number): number | null {
  const pattern = new RegExp(`${SUITE_CALL}(['"\`])${escapeRegExp(name)}\\1`, 'u');
  for (let index = Math.min(before, lines.length) - 1; index >= 1; index -= 1) {
    if (pattern.test(lines[index - 1] ?? '')) return index;
  }
  return null;
}

/**
 * What the editor shows beside a test file after a run: each test's result on
 * its declaration line, each suite's tally on its `describe` line, and the
 * compared values on each failing assertion line. A line answers once; the
 * assertion wins over a test declared on the same line.
 */
export function testLineAnswers(
  cases: readonly ProjectTestDisplayCase[] | null,
  file: string,
  source: string,
  options: { suites: boolean }
): TestLineAnswer[] {
  if (!cases) return [];
  const lines = source.split('\n');
  const byLine = new Map<number, TestLineAnswer>();
  const current = cases.filter(entry => !entry.stale && entry.path.length > 0);
  const inRange = (line: number | undefined): line is number => line !== undefined && Number.isInteger(line) && line >= 1 && line <= lines.length;

  for (const test of current) {
    if (test.file === file && inRange(test.declarationLine)) {
      byLine.set(test.declarationLine, { kind: 'test', line: test.declarationLine, key: `test:${test.path.join('\u0000')}`, test });
    }
  }
  for (const test of current) {
    if (test.status === 'failed' && test.failureFile === file && inRange(test.failureLine)) {
      byLine.set(test.failureLine, { kind: 'assertion', line: test.failureLine, key: `assert:${test.path.join('\u0000')}`, test });
    }
  }

  if (options.suites) {
    const suites = new Map<string, { path: string[]; first: number; statuses: ProjectTestCaseStatus[] }>();
    for (const test of current) {
      if (test.file !== file || !inRange(test.declarationLine)) continue;
      for (let depth = 1; depth < test.path.length; depth += 1) {
        const path = test.path.slice(0, depth);
        const id = path.join('\u0000');
        const suite = suites.get(id) ?? { path, first: test.declarationLine, statuses: [] };
        suite.first = Math.min(suite.first, test.declarationLine);
        suite.statuses.push(test.status);
        suites.set(id, suite);
      }
    }
    for (const [id, suite] of suites) {
      const line = suiteLine(lines, suite.path[suite.path.length - 1]!, suite.first);
      if (line !== null && !byLine.has(line)) byLine.set(line, { kind: 'suite', line, key: `suite:${id}`, statuses: suite.statuses });
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

/** Passed and counted tests of a suite; skipped tests do not count against it. */
export function suiteTally(statuses: readonly ProjectTestCaseStatus[]): { passed: number; total: number } {
  const counted = statuses.filter(status => status !== 'skipped');
  return { passed: counted.filter(status => status === 'passed').length, total: counted.length };
}

export function formatTestDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

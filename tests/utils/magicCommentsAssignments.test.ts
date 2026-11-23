import { describe, expect, it } from 'vitest';
import {
  applyJSAutoLog,
  detectJSAutoLogLines,
  detectJSMagicComments,
  magicCommentKindsByLine,
  transformJSMagicComments,
} from '@/utils/magicComments';
import { detectJSAssignmentAnswers } from '@/utils/magicComments/jsAssignments';

type Capture = { line: number; value: unknown };
type AsyncFn = (__mc: (line: number, value: unknown) => void) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => AsyncFn;

/** Runs the Scratchpad auto-log pass the way the JS runner does and returns what `__mc` saw. */
async function runScratchpad(code: string): Promise<Capture[]> {
  const magicLines = new Set(detectJSMagicComments(code).map((entry) => entry.line));
  const { code: transformed } = applyJSAutoLog(code, transformJSMagicComments(code), magicLines, 'assignments');
  const captured: Capture[] = [];
  await new AsyncFunction('__mc', transformed)((line, value) => captured.push({ line, value }));
  return captured.sort((a, b) => a.line - b.line);
}

describe('JS/TS assignment answers', () => {
  it('answers single-identifier declarations with their value', async () => {
    const code = ['const api = [38, 41];', 'let total = api.length', 'var label = `n=${total}`;'].join('\n');
    expect(detectJSAssignmentAnswers(code).map(({ line, name }) => [line, name])).toEqual([
      [1, 'api'],
      [2, 'total'],
      [3, 'label'],
    ]);
    expect(await runScratchpad(code)).toEqual([
      { line: 1, value: [38, 41] },
      { line: 2, value: 2 },
      { line: 3, value: 'n=2' },
    ]);
  });

  it('answers a multi-line declaration once, on its first line, after it ran', async () => {
    const code = ['const report = [', '  { service: "api" },', '  { service: "db" },', '] // two rows', 'report.length'].join('\n');
    expect(detectJSAssignmentAnswers(code)).toEqual([{ line: 1, endLine: 4, endColumn: 1, name: 'report' }]);
    expect(await runScratchpad(code)).toEqual([
      { line: 1, value: [{ service: 'api' }, { service: 'db' }] },
      { line: 5, value: 2 },
    ]);
  });

  it('answers reassignments: single-line as expressions, multi-line after the statement', async () => {
    const code = ['let db = [1];', 'db = [1, 2]', 'db = [', '  ...db,', '  3,', ']'].join('\n');
    expect(detectJSAssignmentAnswers(code).map(({ line, name }) => [line, name])).toEqual([
      [1, 'db'],
      [3, 'db'],
    ]);
    expect(await runScratchpad(code)).toEqual([
      { line: 1, value: [1] },
      { line: 2, value: [1, 2] },
      { line: 3, value: [1, 2, 3] },
    ]);
  });

  it('reads TypeScript annotations past their generic commas', () => {
    expect(detectJSAssignmentAnswers('const seen: Map<string, number> = new Map();')).toEqual([
      { line: 1, endLine: 1, endColumn: 44, name: 'seen' },
    ]);
  });

  it.each([
    ['destructuring', 'const { api } = latencies;\nconst [first] = list;'],
    ['declarations without a value', 'let slowest;\nlet ready: boolean;'],
    ['several declarators', 'let a = 1, b = 2;\nlet c = 1,\n  d = 2;'],
    ['function and class declarations', 'function f() {}\nclass Box {}'],
    ['arrow and function values', 'const f = (x) => x * 2;\nconst g = x => x;\nconst h = async () => 1;\nconst k = function () {};\nconst C = class {};\nconst t = (a: number): number => a;'],
    ['generated names', 'let __lp0 = 0;'],
    ['blocks below the top level', 'if (ok) {\n  const inner = 1;\n}'],
    ['a statement the next line continues', 'const total = items\n  .map((x) => x)\n  .length;'],
    ['two statements on one line', 'const a = 1; console.log(a);'],
  ])('skips %s', (_label, code) => {
    expect(detectJSAssignmentAnswers(code)).toEqual([]);
  });

  it('leaves lines claimed by //=> and @watch to the magic comment', async () => {
    const code = ['const z = 21 * 2 //=> answer', 'const w = [', '  1, // @watch z', ']', 'const v = 3'].join('\n');
    const magicLines = new Set(detectJSMagicComments(code).map((entry) => entry.line));
    expect(detectJSAssignmentAnswers(code, magicLines).map(({ line }) => line)).toEqual([5]);
    expect(magicCommentKindsByLine('javascript', code, { autoLog: 'assignments' })).toMatchObject({
      1: 'arrow',
      3: 'watch',
      5: 'autoLog',
    });
  });

  it('keeps expressions-only auto-log when bindings are not asked for', () => {
    const code = 'const x = 5;\nx + 1';
    expect(detectJSAutoLogLines(code)).toEqual([2]);
    expect(detectJSAutoLogLines(code, undefined, 'assignments')).toEqual([2, 1]);
    expect(applyJSAutoLog(code, code, new Set(), true).lines).toEqual([2]);
    expect(magicCommentKindsByLine('javascript', code, { autoLog: true })).toEqual({ 2: 'autoLog' });
    expect(applyJSAutoLog(code, code, new Set(), 'cell')).toEqual({ code, lines: [] });
  });

  it('inserts the capture before a trailing comment and keeps // inside strings', () => {
    const code = 'const url = "https://linguacode.dev" // home';
    const { code: out } = applyJSAutoLog(code, code, new Set(), 'assignments');
    expect(out).toBe('const url = "https://linguacode.dev";void __mc(1, url); // home');
  });
});

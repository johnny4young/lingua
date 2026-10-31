import { describe, expect, it } from 'vitest';
import { instrumentForTimeline } from '../../src/renderer/runtime/timelineInstrument';
import { injectJSLoopProtection } from '../../src/renderer/utils/loopProtection';

interface Step {
  line: number;
  locals: Record<string, unknown>;
  depth: number;
}

function record(source: string) {
  const { code } = instrumentForTimeline(source);
  const steps: Step[] = [];
  const frames: string[] = [];
  const rec = (line: number, locals: () => Record<string, unknown>) => {
    const values = Object.fromEntries(Object.entries(locals()).filter(([, value]) => typeof value !== 'function'));
    steps.push({ line, locals: structuredClone(values), depth: frames.length });
  };
  const enter = (name: string) => frames.push(name);
  const exit = () => frames.pop();
  const result = new Function('__lingua_rec', '__lingua_rec_enter', '__lingua_rec_exit', code)(rec, enter, exit);
  return { code, steps, result, frames };
}

describe('timeline instrumentation', () => {
  it('records statements inside loops, branches and synchronous functions without changing the result', () => {
    const { steps, result, frames } = record(
      [
        'function quickSort(arr) {',
        '  if (arr.length <= 1) return arr;',
        '  const pivot = arr[Math.floor(arr.length / 2)];',
        '  const left = arr.filter((x) => x < pivot);',
        '  return [...quickSort(left), pivot];',
        '}',
        'let total = 0;',
        'for (const n of [1, 2]) {',
        '  total += n;',
        '}',
        'return quickSort([3, 1]).concat(total);',
      ].join('\n')
    );
    expect(result).toEqual([1, 3]);
    expect(frames).toEqual([]);
    expect(steps.map(step => step.line)).toEqual([7, 8, 9, 9, 11, 2, 3, 4, 5, 2]);
    expect(steps[3]!.locals).toMatchObject({ total: 1, n: 2 });
    expect(steps[7]!).toMatchObject({ line: 4, depth: 1, locals: { arr: [3, 1], pivot: 1 } });
    expect(steps[9]!).toMatchObject({ line: 2, depth: 2, locals: { arr: [] } });
  });

  it('skips loop protection guards and leaves hoisted declarations alone', () => {
    const protectedCode = injectJSLoopProtection('let i = 0;\nwhile (i < 2) {\n  i++;\n}\nreturn hoisted();\nfunction hoisted() { return i; }', 100);
    const { steps, result } = record(protectedCode);
    expect(result).toBe(2);
    expect(steps.map(step => step.line)).toEqual([1, 2, 3, 3, 5, 6]);
    expect(steps.every(step => Object.keys(step.locals).every(name => !name.startsWith('__lp')))).toBe(true);
  });

  it('keeps a strict-mode directive first and records async bodies without a frame', () => {
    const { code } = instrumentForTimeline('function strict() {\n  "use strict";\n  return 1;\n}\nasync function later() {\n  return 2;\n}');
    expect(code).toMatch(/function strict\(\) \{\n {2}"use strict";\n {2}__lingua_rec_enter\("strict", 1\); try \{ __lingua_rec\(3,/);
    expect(code).toContain('async function later() {\n  __lingua_rec(6,');
    expect(code).not.toContain('__lingua_rec_enter("later"');
    expect(code.split('\n')).toHaveLength(7);
  });

  it('names arrow functions and methods for the call stack', () => {
    const { code } = instrumentForTimeline('const add = (a, b) => {\n  return a + b;\n};\nclass C {\n  run() {\n    return 1;\n  }\n}');
    expect(code).toContain('__lingua_rec_enter("add", 1)');
    expect(code).toContain('__lingua_rec_enter("run", 5)');
  });

  it('leaves a body whose function declaration shares a var name unwrapped, so it still parses', () => {
    const { code, result } = record('function f() {\n  var g = 1;\n  return typeof g;\n  function g() {}\n}\nreturn f();');
    expect(result).toBe('number');
    expect(code).not.toContain('__lingua_rec_enter("f"');
  });
});

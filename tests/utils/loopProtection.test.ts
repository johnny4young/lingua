import { describe, it, expect } from 'vitest';
import {
  injectJSLoopProtection,
  injectPythonLoopProtection,
  DEFAULT_MAX_ITERATIONS,
} from '@/utils/loopProtection';

describe('JS loop protection', () => {
  it('injects counter before while loop and guard inside', () => {
    const code = 'while (true) {\n  console.log("hi");\n}';
    const result = injectJSLoopProtection(code, 100);
    expect(result).toContain('var __lp0=0;');
    expect(result).toContain('++__lp0>100');
    expect(result).toContain('while (true) {');
  });

  it('injects counter before for loop', () => {
    const code = 'for (let i = 0; ; i++) {\n  doStuff();\n}';
    const result = injectJSLoopProtection(code, 5000);
    expect(result).toContain('var __lp0=0;');
    expect(result).toContain('++__lp0>5000');
  });

  it('injects counter for do-while loop', () => {
    const code = 'do {\n  x++;\n} while (x < 10);';
    const result = injectJSLoopProtection(code, 100);
    expect(result).toContain('var __lp0=0;');
    expect(result).toContain('++__lp0>100');
  });

  it('handles nested loops with unique counters', () => {
    const code = 'for (let i = 0; ; i++) {\n  while (true) {\n    break;\n  }\n}';
    const result = injectJSLoopProtection(code, 100);
    expect(result).toContain('__lp0');
    expect(result).toContain('__lp1');
  });

  it('does not modify code without loops', () => {
    const code = 'const x = 1;\nconsole.log(x);';
    expect(injectJSLoopProtection(code)).toBe(code);
  });

  it('uses default max iterations', () => {
    const code = 'while (true) {\n  x++;\n}';
    const result = injectJSLoopProtection(code);
    expect(result).toContain(`>${DEFAULT_MAX_ITERATIONS}`);
  });

  it('includes line number in error message', () => {
    const code = 'const x = 1;\nwhile (true) {\n  x++;\n}';
    const result = injectJSLoopProtection(code, 100);
    expect(result).toContain('line 2');
  });
});

describe('Python loop protection', () => {
  it('injects counter before while loop and guard inside', () => {
    const code = 'while True:\n    print("hi")';
    const result = injectPythonLoopProtection(code, 100);
    expect(result).toContain('__lp0 = 0');
    expect(result).toContain('__lp0 += 1');
    expect(result).toContain('if __lp0 > 100: raise RuntimeError');
  });

  it('injects counter for for loop', () => {
    const code = 'for i in range(999999999):\n    pass';
    const result = injectPythonLoopProtection(code, 5000);
    expect(result).toContain('__lp0 = 0');
    expect(result).toContain('__lp0 += 1');
    expect(result).toContain('if __lp0 > 5000');
  });

  it('handles nested loops with unique counters', () => {
    const code = 'for i in range(10):\n    while True:\n        break';
    const result = injectPythonLoopProtection(code, 100);
    expect(result).toContain('__lp0');
    expect(result).toContain('__lp1');
  });

  it('preserves indentation for nested loops', () => {
    const code = 'for i in range(10):\n    while True:\n        break';
    const result = injectPythonLoopProtection(code, 100);
    // The inner while loop should have its counter at the same indent level
    const lines = result.split('\n');
    const innerCounter = lines.find((l) => l.includes('__lp1 = 0'));
    expect(innerCounter).toBeDefined();
    expect(innerCounter!.startsWith('    ')).toBe(true);
  });

  it('does not modify code without loops', () => {
    const code = 'x = 1\nprint(x)';
    expect(injectPythonLoopProtection(code)).toBe(code);
  });

  it('includes line number in error message', () => {
    const code = 'x = 1\nwhile True:\n    x += 1';
    const result = injectPythonLoopProtection(code, 100);
    expect(result).toContain('line 2');
  });
});

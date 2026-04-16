import { describe, expect, it } from 'vitest';
import {
  isDynamicResultLanguage,
  toExecutionPresentation,
  toFullOutput,
  toLineResults,
} from '@/utils/executionPresentation';
import type { ExecutionResult } from '@/types';

describe('executionPresentation helpers', () => {
  const dynamicResult: ExecutionResult = {
    stdout: [{ type: 'log', args: ['hello'], line: 1 }],
    stderr: [{ type: 'warn', args: ['careful'], line: 2 }],
    result: 42,
    executionTime: 12,
    magicResults: [{ line: 1, value: 'sum = 1' }],
    error: { message: 'Boom', line: 2, column: 4 },
  };

  it('recognizes dynamic result languages', () => {
    expect(isDynamicResultLanguage('javascript')).toBe(true);
    expect(isDynamicResultLanguage('python')).toBe(true);
    expect(isDynamicResultLanguage('go')).toBe(false);
  });

  it('builds per-line execution output for dynamic languages', () => {
    expect(toLineResults(dynamicResult, 'console.log("hello")\n40 + 2')).toEqual([
      { line: 1, value: 'hello', type: 'log' },
      { line: 2, value: 'careful', type: 'warn' },
      { line: 2, value: '42', type: 'result' },
      { line: 1, value: 'sum = 1', type: 'magic' },
    ]);
  });

  it('falls back to the last non-empty line when output has no explicit source line', () => {
    expect(
      toLineResults(
        {
          stdout: [{ type: 'log', args: ['printed from runtime'] }],
          stderr: [{ type: 'error', args: ['runtime warning'] }],
          executionTime: 7,
        },
        'value = 1\nprint(value)\n'
      )
    ).toEqual([
      { line: 2, value: 'printed from runtime', type: 'log' },
      { line: 2, value: 'runtime warning', type: 'error' },
    ]);
  });

  it('keeps structured runtime errors out of inline stderr duplication', () => {
    expect(
      toLineResults(
        {
          stdout: [{ type: 'log', args: ['Hello, World 2!'], line: 2 }],
          stderr: [{ type: 'error', args: ['Traceback...'], line: 3 }],
          executionTime: 18,
          error: { message: 'Traceback...', line: 3 },
        },
        'print("Hello, World 2!")\ndde + 2'
      )
    ).toEqual([{ line: 2, value: 'Hello, World 2!', type: 'log' }]);
  });

  it('builds full output for compiled languages', () => {
    expect(
      toFullOutput({
        stdout: [{ type: 'log', args: ['compiled ok'] }],
        stderr: [{ type: 'error', args: ['warning: check this'] }],
        executionTime: 18,
      })
    ).toBe('compiled ok\nwarning: check this');

    expect(
      toExecutionPresentation('rust', 'fn main() {}', {
        stdout: [{ type: 'log', args: ['compiled ok'] }],
        stderr: [],
        executionTime: 18,
      })
    ).toEqual({
      lineResults: [],
      fullOutput: 'compiled ok',
    });
  });
});

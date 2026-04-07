import { describe, expect, it } from 'vitest';
import {
  formatExecTime,
  formatExecutionError,
  getCompilationLoadingMessage,
  getCompilationMessage,
  getInitializationMessage,
  toConsoleEntries,
} from '@/hooks/runnerOutput';

describe('runnerOutput helpers', () => {
  it('formats initialization messages for known and custom languages', () => {
    expect(getInitializationMessage('python')).toBe('Loading Python runtime (Pyodide)...');
    expect(getInitializationMessage('lua')).toBe('Initializing lua runner...');
  });

  it('returns compilation messaging only for compiled languages', () => {
    expect(getCompilationLoadingMessage('go')).toBe('Compiling Go to WASM...');
    expect(getCompilationMessage('rust')).toEqual({
      type: 'info',
      content: 'Compiling Rust binary...',
    });
    expect(getCompilationLoadingMessage('javascript')).toBeNull();
    expect(getCompilationMessage('typescript')).toBeNull();
  });

  it('maps execution results into ordered console entries', () => {
    const result = toConsoleEntries({
      stdout: [{ type: 'log', args: ['hello'], line: 2 }],
      stderr: [{ type: 'warn', args: ['careful'] }],
      result: 42,
      executionTime: 1500,
      error: { message: 'Boom', line: 8, column: 3 },
    });

    expect(result).toEqual([
      { type: 'log', content: 'hello', line: 2 },
      { type: 'warn', content: 'careful', line: undefined },
      { type: 'result', content: '42' },
      { type: 'error', content: 'Boom (line 8:3)' },
      { type: 'info', content: 'Completed in 1.50 s', executionTime: 1500 },
    ]);
  });

  it('formats execution errors only when present', () => {
    expect(formatExecutionError({ stdout: [], stderr: [], executionTime: 0 })).toBeNull();
    expect(
      formatExecutionError({
        stdout: [],
        stderr: [],
        executionTime: 0,
        error: { message: 'Bad input' },
      })
    ).toEqual({ type: 'error', content: 'Bad input' });
  });

  it('formats short execution times in milliseconds', () => {
    expect(formatExecTime(12.345)).toBe('12.3 ms');
  });
});

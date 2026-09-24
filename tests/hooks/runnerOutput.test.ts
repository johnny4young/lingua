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
  it('retains interleaved captures and emits only unstreamed completion entries', () => {
    const result = {
      stdout: [{ type: 'log' as const, args: ['middle'], captureOrder: 1 }],
      stderr: [{ type: 'error' as const, args: ['first'], captureOrder: 0 }], executionTime: 0,
    };
    expect(toConsoleEntries(result).slice(0, 2).map(entry => entry.content)).toEqual(['first', 'middle']);
    expect(toConsoleEntries(result, 'javascript', { streamed: true }).map(entry => entry.content))
      .toEqual(['Completed in 0.0 ms']);
  });

  it('does not duplicate a primary browser failure that was already streamed', () => {
    const result = { stdout: [], stderr: [{ type: 'error' as const, args: ['fatal'],
      captureOrder: 0, isExecutionError: true }], error: { message: 'fatal' }, executionTime: 0 };
    expect(toConsoleEntries(result).filter(entry => entry.type === 'error')).toHaveLength(1);
    expect(toConsoleEntries(result, 'javascript', { streamed: true }).filter(entry => entry.type === 'error')).toHaveLength(0);
  });

  it('surfaces each captured error once without turning later values into errors', () => {
    const entries = toConsoleEntries({
      stdout: [], stderr: [], executionTime: 4, kind: 'success',
      magicResults: [
        { line: 1, value: 'SyntaxError: bad JSON', kind: 'autoLog', isError: true },
        { line: 2, value: '42', kind: 'autoLog' },
        { line: 3, value: 'Error: another failure', kind: 'watch', isError: true },
      ],
    }, 'javascript');
    expect(entries.filter(entry => entry.type === 'error')).toEqual([
      { type: 'error', content: 'SyntaxError: bad JSON', line: 1, language: 'javascript' },
      { type: 'error', content: 'Error: another failure', line: 3, language: 'javascript' },
    ]);
    expect(entries.at(-1)?.content).toBe('Failed in 4.0 ms');
  });

  it.each([
    ['success', 'Completed'], ['error', 'Failed'], ['stopped', 'Stopped'], ['timeout', 'Timed out'],
  ] as const)('labels %s distinctly even without a top-level error', (kind, label) => {
    const entries = toConsoleEntries({ stdout: [], stderr: [], executionTime: 4, kind });
    expect(entries.at(-1)?.content).toBe(`${label} in 4.0 ms`);
  });

  it.each([
    [{ kind: 'timeout' as const }, 'Timed out'],
    [{ kind: 'stopped' as const }, 'Stopped'],
    [{ cancelled: true, kind: 'success' as const }, 'Stopped'],
  ])('preserves termination precedence over captures (%j)', (termination, label) => {
    const entries = toConsoleEntries({
      stdout: [], stderr: [], executionTime: 4, ...termination,
      magicResults: [{ line: 1, value: 'Error: captured', isError: true }],
    });
    expect(entries.at(-1)?.content).toBe(`${label} in 4.0 ms`);
  });

  it('does not treat console.error as an uncaught execution failure', () => {
    const entries = toConsoleEntries({
      stdout: [], stderr: [{ type: 'error', args: ['intentional log'] }], executionTime: 4,
    });
    expect(entries.at(-1)?.content).toBe('Completed in 4.0 ms');
  });

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
      { type: 'info', content: 'Failed in 1.50 s', executionTime: 1500 },
    ]);
  });

  it('preserves rich console payloads while keeping the legacy content fallback', () => {
    const payload = [{ kind: 'table' as const, columns: ['name'], rows: [] }];
    const result = toConsoleEntries({
      stdout: [{ type: 'log', args: ['Table(0×1)'], payload }],
      stderr: [],
      executionTime: 4,
    });

    expect(result[0]).toEqual({
      type: 'log',
      content: 'Table(0×1)',
      line: undefined,
      payload,
    });
  });

  it('threads the source language onto console output entries when provided', () => {
    const payload = [{ kind: 'error' as const, message: 'boom' }];
    const result = toConsoleEntries(
      {
        stdout: [{ type: 'log', args: ['Error: boom'], payload }],
        stderr: [{ type: 'error', args: ['stderr'] }],
        executionTime: 4,
      },
      'python'
    );

    expect(result[0]).toMatchObject({
      type: 'log',
      language: 'python',
      payload,
    });
    expect(result[1]).toMatchObject({
      type: 'error',
      language: 'python',
    });
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

  it('attaches clickable-stack payloads to execution errors with frames', () => {
    expect(
      formatExecutionError({
        stdout: [],
        stderr: [],
        executionTime: 0,
        error: {
          message: 'Bad input',
          frames: [
            {
              text: 'at run (src/example.ts:12:5)',
              file: 'src/example.ts',
              line: 12,
              column: 5,
            },
          ],
        },
      })
    ).toEqual({
      type: 'error',
      content: 'Bad input',
      payload: [
        {
          kind: 'error',
          message: 'Bad input',
          stack: [
            {
              text: 'at run (src/example.ts:12:5)',
              file: 'src/example.ts',
              line: 12,
              column: 5,
            },
          ],
        },
      ],
    });
  });

  it('formats short execution times in milliseconds', () => {
    expect(formatExecTime(12.345)).toBe('12.3 ms');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { applyAutoRunResult } from '@/hooks/autoRunResult';
import { useConsoleStore } from '@/stores/consoleStore';
import { useResultStore } from '@/stores/resultStore';
import type { ExecutionResult } from '@/types/execution';

const watchCode = 'const total = 50;\ntotal; // @watch total';

function executionResult(
  overrides: Partial<ExecutionResult> = {}
): ExecutionResult {
  return {
    stdout: [],
    stderr: [],
    result: undefined,
    executionTime: 2,
    error: null,
    ...overrides,
  };
}

function captureWatchSnapshot(): void {
  applyAutoRunResult({
    code: watchCode,
    language: 'javascript',
    result: executionResult({
      magicResults: [{ line: 2, value: '50', kind: 'watch' }],
    }),
  });
}

describe('applyAutoRunResult', () => {
  beforeEach(() => {
    useResultStore.getState().clear();
    useConsoleStore.getState().clear();
  });

  it('marks captured failures without losing later captures or replacing the last success', () => {
    captureWatchSnapshot();
    const snapshot = useResultStore.getState().lastSuccessfulSnapshot;
    applyAutoRunResult({
      autoLogEnabled: true, code: 'JSON.parse("invalid")\n42', language: 'javascript',
      result: executionResult({ kind: 'success', magicResults: [
        { line: 1, value: 'SyntaxError: bad JSON', kind: 'autoLog', isError: true },
        { line: 2, value: '42', kind: 'autoLog' },
      ] }),
    });
    expect(useResultStore.getState().diagnostics).toMatchObject([
      { message: 'SyntaxError: bad JSON', line: 1, severity: 'error', source: 'javascript' },
    ]);
    expect(useResultStore.getState().lineResults).toEqual([
      { line: 1, value: 'SyntaxError: bad JSON', type: 'error' },
      { line: 2, value: '42', type: 'autoLog' },
    ]);
    expect(useResultStore.getState().lastSuccessfulSnapshot).toBe(snapshot);
    expect(useResultStore.getState().error?.message).toBe('SyntaxError: bad JSON');
    expect(useConsoleStore.getState().entries.filter(entry => entry.type === 'error')).toHaveLength(1);
  });

  it('does not restore a watch row that no longer exists in the failed source', () => {
    captureWatchSnapshot();

    applyAutoRunResult({
      code: 'throw new Error("boom");',
      language: 'javascript',
      result: executionResult({
        error: { message: 'boom', line: 1 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 1, value: 'boom', type: 'error' },
    ]);
  });

  it('keeps an unchanged watch when a different line fails', () => {
    captureWatchSnapshot();

    applyAutoRunResult({
      code: `${watchCode}\nthrow new Error("boom");`,
      language: 'javascript',
      result: executionResult({
        error: { message: 'boom', line: 3 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 3, value: 'boom', type: 'error' },
      { line: 2, value: '50', type: 'watch' },
    ]);
  });

  it('invalidates a watch when its expression changes on the same line', () => {
    captureWatchSnapshot();

    applyAutoRunResult({
      code: [
        'const other = 75;',
        'other; // @watch other',
        'throw new Error("boom");',
      ].join('\n'),
      language: 'javascript',
      result: executionResult({
        error: { message: 'boom', line: 3 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 3, value: 'boom', type: 'error' },
    ]);
  });

  it('invalidates a watch when the watch line itself fails', () => {
    captureWatchSnapshot();

    applyAutoRunResult({
      code: watchCode,
      language: 'javascript',
      result: executionResult({
        error: { message: 'total is not defined', line: 2 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 2, value: 'total is not defined', type: 'error' },
    ]);
  });

  it('invalidates a watch when the error location is unknown', () => {
    captureWatchSnapshot();

    applyAutoRunResult({
      code: watchCode,
      language: 'javascript',
      result: executionResult({
        error: { message: 'unknown failure' },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 2, value: 'unknown failure', type: 'error' },
    ]);
  });

  it('invalidates a watch inside a ranged error location', () => {
    captureWatchSnapshot();

    applyAutoRunResult({
      code: watchCode,
      language: 'javascript',
      result: executionResult({
        error: { message: 'ranged failure', line: 1, endLine: 2 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 1, value: 'ranged failure', type: 'error' },
    ]);
  });

  it('invalidates an auto-log row when auto-log is disabled', () => {
    const code = 'const total = 50;\ntotal';
    applyAutoRunResult({
      autoLogEnabled: true,
      code,
      language: 'javascript',
      result: executionResult({
        magicResults: [{ line: 2, value: '50', kind: 'autoLog' }],
      }),
    });

    applyAutoRunResult({
      autoLogEnabled: false,
      code: `${code}\nthrow new Error("boom");`,
      language: 'javascript',
      result: executionResult({
        error: { message: 'boom', line: 3 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 3, value: 'boom', type: 'error' },
    ]);
  });

  it('keeps an unchanged auto-log row while auto-log remains enabled', () => {
    const code = 'const total = 50;\ntotal';
    applyAutoRunResult({
      autoLogEnabled: true,
      code,
      language: 'javascript',
      result: executionResult({
        magicResults: [{ line: 2, value: '50', kind: 'autoLog' }],
      }),
    });

    applyAutoRunResult({
      autoLogEnabled: true,
      code: `${code}\nthrow new Error("boom");`,
      language: 'javascript',
      result: executionResult({
        error: { message: 'boom', line: 3 },
      }),
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 3, value: 'boom', type: 'error' },
      { line: 2, value: '50', type: 'autoLog' },
    ]);
  });
});

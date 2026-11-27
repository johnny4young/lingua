import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAutoRunResult } from '@/hooks/autoRunResult';
import { useConsoleStore } from '@/stores/consoleStore';
import { useResultStore } from '@/stores/resultStore';
import { useEditorStore } from '@/stores/editorStore';
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

  it('adds only what the stream left out to a console run begun at the start', () => {
    useConsoleStore.getState().beginRun({ tabId: 'tab', startedAt: 1_000, number: 3 });
    useConsoleStore.getState().addEntry({ type: 'log', content: 'streamed', line: 1 });
    applyAutoRunResult({
      code: 'print("streamed")', language: 'python', tabId: 'tab', streamedConsole: true,
      result: executionResult({ stdout: [{ type: 'log', args: ['streamed'], line: 1 }] }),
    });
    const state = useConsoleStore.getState();
    expect(state.entries.map(entry => entry.content)).toEqual(['streamed']);
    expect(state.currentRun).toEqual({ tabId: 'tab', number: 3, startedAt: 1_000 });
  });

  it('adds every row and a failure row when nothing streamed', () => {
    useConsoleStore.getState().beginRun({ tabId: 'tab', startedAt: null, number: 3 });
    applyAutoRunResult({
      code: 'boom()', language: 'javascript', tabId: 'tab', 
      result: executionResult({ error: { message: 'boom is not defined', line: 1 } }),
    });
    const state = useConsoleStore.getState();
    expect(state.currentRun?.startedAt).toBeNull();
    expect(state.entries.map(entry => entry.content)).toEqual(['boom is not defined (line 1)', 'Failed in 2.0 ms']);
  });

  it('keeps the run answer on its tab', async () => {
    useEditorStore.setState({ tabs: [{ id: 'tab-a', name: 'a.js', language: 'javascript', content: '', isDirty: false }], activeTabId: 'tab-a' });
    applyAutoRunResult({
      code: '[1, 2, 3].map(n => n * n)', language: 'javascript', tabId: 'tab-a',
      result: executionResult({ magicResults: [{ line: 1, value: '[1,4,9]', kind: 'autoLog' }] }),
    });
    await vi.waitFor(() => expect(useEditorStore.getState().tabs[0]?.lastAnswer).toMatchObject({
      kind: 'code', status: 'ok', numeral: '1 – 9', unit: 'items', total: 3, picture: { kind: 'bars', values: [11, 44, 100] }, durationMs: 2,
    }));
    useEditorStore.setState({ tabs: [], activeTabId: null });
  });

  it('replaces the variable scope from a failed run that still captured one', () => {
    const scope = (name: string) => ({ language: 'javascript' as const, variables: [{ name }] }) as never;
    applyAutoRunResult({ code: 'const a = 1', language: 'javascript', result: executionResult({ scopeSnapshot: scope('a') }) });
    const fresh = scope('b');
    applyAutoRunResult({
      code: 'const b = 2\nthrow 1', language: 'javascript',
      result: executionResult({ error: { message: 'boom', line: 2 }, scopeSnapshot: fresh }),
    });
    expect(useResultStore.getState().scopeSnapshot).toBe(fresh);
    applyAutoRunResult({
      code: 'throw 1', language: 'javascript',
      result: executionResult({ error: { message: 'boom', line: 1 } }),
    });
    expect(useResultStore.getState().scopeSnapshot).toBe(fresh);
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

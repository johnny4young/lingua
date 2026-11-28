/**
 * `useNotebookRun` orchestration coverage.
 */

import { act, renderHook } from '@testing-library/react';
import { registerNotebookDocumentDraft } from '../../src/renderer/stores/notebookDocumentDrafts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../src/renderer/i18n';
import { useAnnouncerStore } from '../../src/renderer/stores/announcerStore';

vi.mock('../../src/renderer/runners', () => ({
  runnerManager: {
    execute: vi.fn(),
    stop: vi.fn(),
    // implementation Slice F — the hook checks this before a Python run
    // to decide whether to surface the "starting Python" notice. Default
    // false so the bulk of the suite never trips the notice.
    needsInitialization: vi.fn(() => false),
  },
}));

vi.mock('../../src/renderer/runtime/duckdbClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/runtime/duckdbClient')>()),
  executeQuery: vi.fn(),
  executeSqlInTransaction: vi.fn(),
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));

import { useNotebookRun } from '../../src/renderer/hooks/useNotebookRun';
import { runnerManager } from '../../src/renderer/runners';
import { trackEvent } from '../../src/renderer/utils/telemetry';
import {
  __setDuckDbEngineFactoryForTests,
  executeQuery,
  executeSqlInTransaction,
  getDuckDbDataGeneration,
  getDuckDbEngine,
  restartDuckDbEngine,
  type DuckDbEngineHandle,
} from '../../src/renderer/runtime/duckdbClient';
import {
  disposeNotebookSession,
  resetNotebookSessionsForTests,
} from '../../src/renderer/runtime/notebookSession';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../src/renderer/stores/notebookStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import {
  claimNotebookRunner,
  notebookRunnerOwner,
  resetNotebookRunnerLocksForTests,
} from '../../src/renderer/stores/notebookRunnerLockStore';
import type { ManualRunSession } from '../../src/renderer/runtime/manualRunSession';
import type { NotebookCellLanguage } from '../../src/shared/notebook';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;
const mockStop = runnerManager.stop as unknown as ReturnType<typeof vi.fn>;
const mockNeedsInit =
  runnerManager.needsInitialization as unknown as ReturnType<typeof vi.fn>;
const mockTrack = trackEvent as unknown as ReturnType<typeof vi.fn>;
const mockQuery = executeQuery as unknown as ReturnType<typeof vi.fn>;
const mockScript = executeSqlInTransaction as unknown as ReturnType<typeof vi.fn>;

function sqlOutcome(overrides: Record<string, unknown> = {}) {
  return { status: 'success', rows: [], columns: [], rowCount: 0, durationMs: 1, tooLarge: false, statementCount: 1, ...overrides };
}

const CREATE_BY_CITY = 'CREATE TABLE by_city AS SELECT 1 AS n;';

/** SQL CREATE → SQL SELECT → Python → Python, all run once; `stale` lists the cells marked stale. */
function seedSqlPythonNotebook(stale: ReadonlyArray<string>, sqlEngineGeneration?: number): void {
  const code = (id: string, language: NotebookCellLanguage, source: string) => ({
    kind: 'code' as const,
    id,
    language,
    source,
    outputs: [{ kind: 'text' as const, stream: 'stdout' as const, text: 'old' }],
  });
  const ids = ['sql-create', 'sql-read', 'py-tickets', 'py-over'];
  useNotebookStore.setState({
    notebooks: {
      'tab-sql': {
        notebook: {
          version: 1,
          id: 'notebook-sql',
          title: 'Q4 orders review',
          cells: [
            code('sql-create', 'sql', CREATE_BY_CITY),
            code('sql-read', 'sql', 'SELECT n FROM by_city;'),
            code('py-tickets', 'python', 'tickets = [1, 2, 3]'),
            code('py-over', 'python', 'len(tickets)'),
          ],
        },
        cellRunStatus: Object.fromEntries(ids.map((id) => [id, stale.includes(id) ? 'stale' : 'ok'])),
        cellExecutionOrder: Object.fromEntries(ids.map((id, index) => [id, index + 1])),
        cellVarFlow: {
          'sql-create': { uses: [], produces: ['by_city'], ...(sqlEngineGeneration !== undefined ? { sqlEngineGeneration } : {}) },
          ...(sqlEngineGeneration !== undefined ? { 'sql-read': { uses: ['by_city'], produces: [], sqlEngineGeneration } } : {}),
        },
        executionCounter: 4,
        activeCellId: 'py-tickets',
      },
    },
  });
}

function seedNotebook(tabId: string): {
  jsCellId: string;
  mdCellId: string;
} {
  resetNotebookStoreForTests();
  useNotebookStore.getState().createNotebookForTab(tabId, 'Test');
  const cells = useNotebookStore.getState().getNotebookForTab(tabId)!.cells;
  return {
    mdCellId: cells.find((c) => c.kind === 'markdown')!.id,
    jsCellId: cells.find((c) => c.kind === 'code')!.id,
  };
}

function seedSingleCodeCellNotebook(
  tabId: string,
  language: NotebookCellLanguage
): void {
  resetNotebookStoreForTests();
  useNotebookStore.setState({
    notebooks: {
      [tabId]: {
        notebook: {
          version: 1,
          id: `notebook-${tabId}`,
          title: 'Single code cell',
          cells: [
            {
              kind: 'code',
              id: 'cell-1',
              language,
              source: language === 'python' ? 'print("hi")' : 'x',
              outputs: [],
            },
          ],
        },
        cellRunStatus: {},
        activeCellId: 'cell-1',
      },
    },
  });
}

describe('useNotebookRun', () => {
  const initialEditor = useEditorStore.getState();
  const initialResult = useResultStore.getState();

  beforeEach(async () => {
    resetNotebookSessionsForTests();
    resetNotebookRunnerLocksForTests();
    useEditorStore.setState(initialEditor, true);
    useResultStore.setState(initialResult, true);
    resetNotebookStoreForTests();
    mockExecute.mockReset();
    mockStop.mockReset();
    mockTrack.mockReset();
    mockQuery.mockReset();
    mockScript.mockReset();
    localStorage.clear();
    useUIStore.setState({ statusNotice: null });
    useAnnouncerStore.setState({ message: '', nonce: 0 });
    initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    resetNotebookSessionsForTests();
    resetNotebookRunnerLocksForTests();
    useEditorStore.setState(initialEditor, true);
    useResultStore.setState(initialResult, true);
    resetNotebookStoreForTests();
    localStorage.clear();
    useUIStore.setState({ statusNotice: null });
  });

  it('runAll runs the edit still waiting in a cell draft', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    const { jsCellId } = seedNotebook('tab-1');
    const unregister = registerNotebookDocumentDraft('tab-1', () =>
      useNotebookStore.getState().updateCellSource('tab-1', jsCellId, 'const typed = 1;')
    );
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runAll('tab-1');
    });
    unregister();
    expect(JSON.stringify(mockExecute.mock.calls[0])).toContain('const typed = 1;');
  });

  it('runCell flips status to running then ok and writes outputs', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: ['hi'], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    const { jsCellId } = seedNotebook('tab-1');
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runCell('tab-1', jsCellId);
    });
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-1', jsCellId)
    ).toBe('ok');
    const cell = useNotebookStore
      .getState()
      .getNotebookForTab('tab-1')!
      .cells.find((c) => c.id === jsCellId)!;
    if (cell.kind === 'code') {
      expect(cell.outputs.map((o) => o.text)).toContain('hi');
    }
    // accessibility pass — a successful single-cell run is announced to AT.
    expect(useAnnouncerStore.getState().message).toMatch(/successfully/i);
  });

  it('runCell records error status when the runner returns an error', async () => {
    mockExecute.mockResolvedValue({
      kind: 'error',
      error: { message: 'boom' },
      stdout: [],
      stderr: [],
    });
    const { jsCellId } = seedNotebook('tab-2');
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runCell('tab-2', jsCellId);
    });
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-2', jsCellId)
    ).toBe('error');
    expect(useAnnouncerStore.getState().message).toMatch(/failed/i);
  });

  it('runCell records stopped status when the runner cancels', async () => {
    mockExecute.mockResolvedValue({
      kind: 'stopped',
      cancelled: true,
      stdout: [],
      stderr: [],
    });
    const { jsCellId } = seedNotebook('tab-3');
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runCell('tab-3', jsCellId);
    });
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-3', jsCellId)
    ).toBe('stopped');
    expect(useAnnouncerStore.getState().message).toMatch(/stopped/i);
  });

  it('does not overwrite a reopened notebook with an old cell completion', async () => {
    seedSingleCodeCellNotebook('tab-reopened', 'javascript');
    let finishOldRun!: (value: unknown) => void;
    mockExecute.mockImplementationOnce(
      () => new Promise(resolve => {
        finishOldRun = resolve;
      })
    );
    const { result } = renderHook(() => useNotebookRun());
    let oldRun!: Promise<void>;
    act(() => {
      oldRun = result.current.runCell('tab-reopened', 'cell-1');
    });
    await vi.waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));

    act(() => {
      disposeNotebookSession('tab-reopened');
      seedSingleCodeCellNotebook('tab-reopened', 'javascript');
      useNotebookStore.getState().setCellOutputs('tab-reopened', 'cell-1', [
        { kind: 'text', stream: 'stdout', text: 'new notebook' },
      ]);
      useNotebookStore.getState().setCellRunStatus('tab-reopened', 'cell-1', 'ok');
    });
    await act(async () => {
      finishOldRun({
        kind: 'ok',
        structuredResult: { stdout: ['old notebook'], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
      await oldRun;
    });

    expect(useNotebookStore.getState().getCellRunStatus('tab-reopened', 'cell-1')).toBe('ok');
    expect(useNotebookStore.getState().getNotebookForTab('tab-reopened')?.cells).toEqual([
      expect.objectContaining({
        outputs: [{ kind: 'text', stream: 'stdout', text: 'new notebook' }],
      }),
    ]);
    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('keeps the busy indicator owned by a newer cell after an old run settles', async () => {
    seedSingleCodeCellNotebook('tab-busy', 'javascript');
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    mockExecute
      .mockImplementationOnce(() => new Promise(resolve => {
        finishOld = resolve;
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        finishNew = resolve;
      }));
    const { result } = renderHook(() => useNotebookRun());
    let oldRun!: Promise<void>;
    act(() => {
      oldRun = result.current.runCell('tab-busy', 'cell-1');
    });
    await vi.waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    act(() => {
      disposeNotebookSession('tab-busy');
      seedSingleCodeCellNotebook('tab-busy', 'javascript');
    });
    let newRun!: Promise<void>;
    act(() => {
      newRun = result.current.runCell('tab-busy', 'cell-1');
    });
    await vi.waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(2));

    await act(async () => {
      finishOld({
        kind: 'ok',
        structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
      await oldRun;
    });
    expect(result.current.isAnyCellRunning).toBe(true);
    expect(useNotebookStore.getState().getCellRunStatus('tab-busy', 'cell-1')).toBe('running');

    await act(async () => {
      finishNew({
        kind: 'ok',
        structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
      await newRun;
    });
    expect(result.current.isAnyCellRunning).toBe(false);
    expect(useNotebookStore.getState().getCellRunStatus('tab-busy', 'cell-1')).toBe('ok');
  });

  it('runCell emits a closed-enum telemetry payload', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    const { jsCellId } = seedNotebook('tab-4');
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runCell('tab-4', jsCellId);
    });
    expect(mockTrack).toHaveBeenCalledWith('notebook.cell_executed', {
      language: 'javascript',
      status: 'ok',
    });
  });

  it('runAll iterates only code cells and stops on the first error', async () => {
    seedNotebook('tab-5');
    // Add a second code cell.
    const secondCellId = useNotebookStore.getState().addCell('tab-5', null, {
      kind: 'code',
      language: 'javascript',
    });
    expect(typeof secondCellId).toBe('string');
    mockExecute
      .mockResolvedValueOnce({
        kind: 'error',
        error: { message: 'first fails' },
        stdout: [],
        stderr: [],
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        structuredResult: { stdout: ['unused'], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runAll('tab-5');
    });
    // Second cell never runs.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    // accessibility pass reviewer fix — range runs also announce their terminal outcome.
    expect(useAnnouncerStore.getState().message).toMatch(/failed after 1 cell/i);
  });

  it('runAll runs a Python-only notebook through the python runner ', async () => {
    seedSingleCodeCellNotebook('tab-python', 'python');
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: 'hi',
      stdout: [{ args: ['hi'] }],
      stderr: [],
    });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.runAll('tab-python');
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0]?.[0]).toBe('python');
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-python', 'cell-1')
    ).toBe('ok');
    expect(useAnnouncerStore.getState().message).toMatch(
      /1 cell ran successfully/i
    );
  });

  it('runAll surfaces a notice when every code cell is an unsupported language', async () => {
    // All three real code-cell languages run now , so the
    // notice path is exercised with an out-of-enum language cast.
    seedSingleCodeCellNotebook('tab-unsupported', 'ruby' as NotebookCellLanguage);
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.runAll('tab-unsupported');
    });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'notebook.notice.languageNotSupported',
    });
  });

  it('surfaces the "starting Python" notice on a cold Python run', async () => {
    seedSingleCodeCellNotebook('tab-cold', 'python');
    mockNeedsInit.mockReturnValueOnce(true);
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: '',
      stdout: [{ args: ['hi'] }],
      stderr: [],
    });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.runCell('tab-cold', 'cell-1');
    });

    expect(mockNeedsInit).toHaveBeenCalledWith('python');
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'notebook.notice.pythonStarting',
    });
  });

  it('runFromHere runs the given cell + every code cell below it in order', async () => {
    const { jsCellId } = seedNotebook('tab-from');
    // Notebook seeds [markdown, code]. Insert a second code cell after
    // the first so we have an above / from-here split: [md, code1, code2].
    const secondCellId = useNotebookStore.getState().addCell('tab-from', jsCellId, {
      kind: 'code',
      language: 'javascript',
    });
    expect(typeof secondCellId).toBe('string');
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: ['ok'], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    const { result } = renderHook(() => useNotebookRun());
    // Run from the SECOND code cell — only it should run, not the first.
    await act(async () => {
      await result.current.runFromHere('tab-from', secondCellId as string);
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-from', secondCellId as string)
    ).toBe('ok');
    // The first code cell above the start point never ran.
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-from', jsCellId)
    ).toBe('idle');
  });

  it('runFromHere stops at the first error', async () => {
    const { jsCellId } = seedNotebook('tab-from-err');
    const secondCellId = useNotebookStore.getState().addCell(
      'tab-from-err',
      jsCellId,
      { kind: 'code', language: 'javascript' }
    );
    mockExecute
      .mockResolvedValueOnce({
        kind: 'error',
        error: { message: 'boom' },
        stdout: [],
        stderr: [],
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runFromHere('tab-from-err', jsCellId);
    });
    // First cell errors → second code cell never runs.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    void secondCellId;
  });

  it('a settled run stamps a monotonic [N] execution order onto the cell', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    const { jsCellId } = seedNotebook('tab-exec-run');
    const { result } = renderHook(() => useNotebookRun());
    expect(
      useNotebookStore.getState().getCellExecutionOrder('tab-exec-run', jsCellId)
    ).toBeNull();
    await act(async () => {
      await result.current.runCell('tab-exec-run', jsCellId);
    });
    expect(
      useNotebookStore.getState().getCellExecutionOrder('tab-exec-run', jsCellId)
    ).toBe(1);
    // Re-running bumps the stamp.
    await act(async () => {
      await result.current.runCell('tab-exec-run', jsCellId);
    });
    expect(
      useNotebookStore.getState().getCellExecutionOrder('tab-exec-run', jsCellId)
    ).toBe(2);
  });

  it('refreshStale rebuilds the notebook session and replays the executed cross-language prefix', async () => {
    useNotebookStore.setState({
      notebooks: {
        'tab-refresh': {
          notebook: {
            version: 1,
            id: 'notebook-refresh',
            title: 'Reactive notebook',
            cells: [
              {
                kind: 'code',
                id: 'cell-js',
                language: 'javascript',
                source: 'const answer = 42',
                outputs: [
                  { kind: 'text', stream: 'stdout', text: 'old js' },
                ],
              },
              {
                kind: 'code',
                id: 'cell-python',
                language: 'python',
                source: 'print("ready")',
                outputs: [
                  { kind: 'text', stream: 'stdout', text: 'old python' },
                ],
              },
              {
                kind: 'code',
                id: 'cell-never-run',
                language: 'javascript',
                source: 'console.log("later")',
                outputs: [],
              },
            ],
          },
          cellRunStatus: {
            'cell-js': 'stale',
            'cell-python': 'stale',
          },
          cellExecutionOrder: { 'cell-js': 1, 'cell-python': 2 },
          executionCounter: 2,
          activeCellId: 'cell-js',
        },
      },
    });
    mockExecute.mockImplementation(async (language: string) =>
      language === 'python'
        ? {
            kind: 'ok',
            result: '',
            stdout: [{ args: ['ready'] }],
            stderr: [],
          }
        : {
            kind: 'ok',
            structuredResult: {
              stdout: ['42'],
              stderr: [],
              sessionDelta: { answer: 42 },
            },
            stdout: [],
            stderr: [],
          }
    );
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-refresh');
    });

    expect(mockExecute.mock.calls.map((call) => call[0])).toEqual([
      'javascript',
      'python',
    ]);
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-refresh', 'cell-js')
    ).toBe('ok');
    expect(
      useNotebookStore
        .getState()
        .getCellRunStatus('tab-refresh', 'cell-python')
    ).toBe('ok');
    expect(
      useNotebookStore
        .getState()
        .getCellRunStatus('tab-refresh', 'cell-never-run')
    ).toBe('idle');
    expect(useAnnouncerStore.getState().message).toMatch(
      /2 executed cells replayed successfully/i
    );
  });

  it('refreshStale leaves current SQL cells alone: their tables outlive the kernel rebuild', async () => {
    seedSqlPythonNotebook(['py-over']);
    mockExecute.mockResolvedValue({ kind: 'ok', result: '', stdout: [], stderr: [] });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-sql', 'py-over');
    });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockScript).not.toHaveBeenCalled();
    expect(mockExecute.mock.calls.map((call) => call[0])).toEqual(['python', 'python']);
    const statuses = useNotebookStore.getState().notebooks['tab-sql']!.cellRunStatus;
    expect(statuses).toMatchObject({ 'sql-create': 'ok', 'sql-read': 'ok', 'py-tickets': 'ok', 'py-over': 'ok' });
  });

  it('replays current SQL cells whose engine dropped its tables and records the new generation', async () => {
    seedSqlPythonNotebook(['py-over'], getDuckDbDataGeneration() - 1);
    mockScript.mockImplementation(async (statements: string[]) => statements.map(() => sqlOutcome({ rows: [{ Count: 1 }], rowCount: 1 })));
    mockQuery.mockImplementation(async (sql: string) =>
      sqlOutcome(/DESCRIBE/.test(sql) ? { rows: [{ c: 1 }], rowCount: 1 } : { rows: [{ n: 1 }], rowCount: 1, columns: [{ name: 'n' }] })
    );
    mockExecute.mockResolvedValue({ kind: 'ok', result: '', stdout: [], stderr: [] });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-sql', 'py-over');
    });

    expect(mockScript.mock.calls[0]![0]).toEqual(['DROP TABLE IF EXISTS by_city', CREATE_BY_CITY]);
    expect(mockQuery.mock.calls.map((call) => call[0])).toContain('SELECT n FROM by_city;');
    const slice = useNotebookStore.getState().notebooks['tab-sql']!;
    expect(slice.cellRunStatus).toMatchObject({ 'sql-create': 'ok', 'sql-read': 'ok', 'py-tickets': 'ok', 'py-over': 'ok' });
    expect(slice.cellVarFlow?.['sql-create']?.sqlEngineGeneration).toBe(getDuckDbDataGeneration());
  });

  it('marks SQL cells stale once the engine drops their tables, and leaves other cells alone', async () => {
    seedSqlPythonNotebook([], getDuckDbDataGeneration());
    useNotebookStore.setState((state) => {
      const slice = state.notebooks['tab-sql']!;
      return { notebooks: { 'tab-sql': { ...slice, cellRunStatus: { ...slice.cellRunStatus, 'sql-read': 'error' } } } };
    });
    const engine = { connect: vi.fn(), terminate: vi.fn(async () => undefined) } as unknown as DuckDbEngineHandle;
    __setDuckDbEngineFactoryForTests(async () => engine);
    try {
      await getDuckDbEngine();
      await restartDuckDbEngine();
    } finally {
      __setDuckDbEngineFactoryForTests(null);
    }

    expect(useNotebookStore.getState().notebooks['tab-sql']!.cellRunStatus).toEqual({
      'sql-create': 'stale',
      'sql-read': 'error',
      'py-tickets': 'ok',
      'py-over': 'ok',
    });
  });

  it('replaces the table a stale SQL cell made instead of failing on it, then refreshes the cells below', async () => {
    seedSqlPythonNotebook(['sql-create', 'sql-read', 'py-tickets', 'py-over']);
    mockScript.mockImplementation(async (statements: string[]) =>
      statements.map((statement) => sqlOutcome(statement === CREATE_BY_CITY ? { rows: [{ Count: 1 }], rowCount: 1 } : {}))
    );
    mockQuery.mockImplementation(async (sql: string) =>
      sqlOutcome(/DESCRIBE/.test(sql) ? { rows: [{ c: 1 }], rowCount: 1 } : { rows: [{ n: 1 }], rowCount: 1, columns: [{ name: 'n' }] })
    );
    mockExecute.mockResolvedValue({ kind: 'ok', result: '', stdout: [], stderr: [] });
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-sql');
    });

    expect(mockScript).toHaveBeenCalledTimes(1);
    expect(mockScript.mock.calls[0]![0]).toEqual(['DROP TABLE IF EXISTS by_city', CREATE_BY_CITY]);
    // The SELECT makes nothing, so it runs plainly.
    expect(mockQuery.mock.calls.map((call) => call[0])).toContain('SELECT n FROM by_city;');
    const slice = useNotebookStore.getState().notebooks['tab-sql']!;
    expect(slice.cellRunStatus).toMatchObject({ 'sql-create': 'ok', 'sql-read': 'ok', 'py-tickets': 'ok', 'py-over': 'ok' });
    expect(slice.cellVarFlow?.['sql-create']?.produces).toEqual(['by_city']);
    expect(useAnnouncerStore.getState().message).toMatch(/4 executed cells replayed successfully/i);
  });

  it('keeps a current SQL cell current while the Python replay above it runs', async () => {
    const cell = (id: string, language: NotebookCellLanguage, source: string) => ({
      kind: 'code' as const,
      id,
      language,
      source,
      outputs: [{ kind: 'text' as const, stream: 'stdout' as const, text: 'old' }],
    });
    useNotebookStore.setState({
      notebooks: {
        'tab-mixed': {
          notebook: {
            version: 1,
            id: 'notebook-mixed',
            title: 'Mixed',
            cells: [
              cell('py-setup', 'python', 'base = 1'),
              cell('sql-made', 'sql', CREATE_BY_CITY),
              cell('sql-stale', 'sql', 'SELECT n FROM by_city;'),
              cell('py-late', 'python', 'base + 1'),
            ],
          },
          cellRunStatus: { 'py-setup': 'ok', 'sql-made': 'ok', 'sql-stale': 'stale', 'py-late': 'stale' },
          cellExecutionOrder: { 'py-setup': 1, 'sql-made': 2, 'sql-stale': 3, 'py-late': 4 },
          cellVarFlow: {},
          executionCounter: 4,
          activeCellId: 'py-late',
        },
      },
    });
    mockExecute.mockResolvedValue({ kind: 'ok', result: '', stdout: [], stderr: [] });
    mockQuery.mockResolvedValue(sqlOutcome({ rows: [{ n: 1 }], rowCount: 1, columns: [{ name: 'n' }] }));
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-mixed');
    });

    expect(mockQuery.mock.calls.map((call) => call[0])).toEqual(['SELECT n FROM by_city;']);
    expect(useNotebookStore.getState().notebooks['tab-mixed']!.cellRunStatus).toEqual({
      'py-setup': 'ok',
      'sql-made': 'ok',
      'sql-stale': 'ok',
      'py-late': 'ok',
    });
  });

  it('never drops a table on the word of an answer saved in the notebook file', async () => {
    seedSqlPythonNotebook(['sql-create', 'sql-read', 'py-tickets', 'py-over']);
    const slice = useNotebookStore.getState().notebooks['tab-sql']!;
    const [create, ...rest] = slice.notebook.cells;
    useNotebookStore.setState({
      notebooks: {
        'tab-sql': {
          ...slice,
          cellVarFlow: {},
          notebook: {
            ...slice.notebook,
            cells: [{ ...create!, answers: [{ line: 1, kind: 'table', text: 'by_city' }] } as typeof create, ...rest],
          },
        },
      },
    });
    mockQuery.mockResolvedValue(sqlOutcome({ status: 'sql-error', errorMessage: 'Catalog Error: Table with name by_city already exists!' }));
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-sql');
    });

    expect(mockScript).not.toHaveBeenCalled();
    expect(useNotebookStore.getState().notebooks['tab-sql']!.cellRunStatus['sql-create']).toBe('error');
  });

  it('reports a SQL cell that fails while replacing its table and keeps the replay from going on', async () => {
    seedSqlPythonNotebook(['sql-create', 'sql-read', 'py-tickets', 'py-over']);
    mockScript.mockResolvedValue([
      sqlOutcome(),
      sqlOutcome({ status: 'sql-error', errorMessage: 'Parser Error: syntax error' }),
    ]);
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.refreshStale('tab-sql');
    });

    const slice = useNotebookStore.getState().notebooks['tab-sql']!;
    expect(slice.cellRunStatus['sql-create']).toBe('error');
    expect(slice.notebook.cells[0]!.outputs[0]).toMatchObject({ stream: 'stderr', text: 'Parser Error: syntax error' });
    expect(mockExecute).not.toHaveBeenCalled();
    // The rollback kept the table, so the next run still replaces it.
    expect(slice.cellVarFlow?.['sql-create']?.produces).toEqual(['by_city']);
  });

  function seedManualRunInEditorTab(language: 'javascript' | 'python'): ManualRunSession {
    const cancel = vi.fn();
    const session: ManualRunSession = {
      tabId: 'editor-tab',
      startedAt: 0,
      isCurrent: () => true,
      onCancel: () => () => {},
      cancel,
      finish: () => {},
    };
    useEditorStore.setState({
      tabs: [
        {
          id: 'editor-tab',
          name: language === 'python' ? 'main.py' : 'main.js',
          language,
          content: 'while (true) {}',
          isDirty: false,
        },
      ],
      activeTabId: 'editor-tab',
    });
    useResultStore.setState({
      manualRunSession: session,
      isManualRunning: true,
      manualRunMode: 'run',
    });
    return session;
  }

  it('stop is a no-op on the runners when no cell is in flight', () => {
    const { result } = renderHook(() => useNotebookRun());
    act(() => {
      result.current.stop();
    });
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('stop reaches only the Python runner its cell holds, never a JS manual run in another tab', async () => {
    const manual = seedManualRunInEditorTab('javascript');
    seedSingleCodeCellNotebook('tab-py-stop', 'python');
    let settle!: (value: unknown) => void;
    mockExecute.mockImplementationOnce(
      () => new Promise(resolve => {
        settle = resolve;
      })
    );
    const { result } = renderHook(() => useNotebookRun());
    let run!: Promise<void>;
    act(() => {
      run = result.current.runCell('tab-py-stop', 'cell-1');
    });
    await vi.waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    expect(notebookRunnerOwner('python')).toBe('tab-py-stop');

    act(() => {
      result.current.stop();
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledWith('python');
    expect(manual.cancel).not.toHaveBeenCalled();

    await act(async () => {
      settle({ kind: 'stopped', cancelled: true, stdout: [], stderr: [] });
      await run;
    });
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-py-stop', 'cell-1')
    ).toBe('stopped');
    expect(notebookRunnerOwner('python')).toBeNull();
  });

  it('refuses a JS cell while a manual editor run uses the JS worker', async () => {
    seedManualRunInEditorTab('javascript');
    seedSingleCodeCellNotebook('tab-js-busy', 'javascript');
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runCell('tab-js-busy', 'cell-1');
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-js-busy', 'cell-1')
    ).toBe('idle');
    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'notebook.notice.runtimeBusy',
    });
  });

  it('refuses a cell while another notebook holds its runner', async () => {
    const release = claimNotebookRunner('python', 'other-notebook');
    seedSingleCodeCellNotebook('tab-py-busy', 'python');
    const { result } = renderHook(() => useNotebookRun());
    await act(async () => {
      await result.current.runCell('tab-py-busy', 'cell-1');
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(
      useNotebookStore.getState().getCellRunStatus('tab-py-busy', 'cell-1')
    ).toBe('idle');
    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'notebook.notice.runtimeBusy',
    });
    expect(notebookRunnerOwner('python')).toBe('other-notebook');
    release?.();
  });
});

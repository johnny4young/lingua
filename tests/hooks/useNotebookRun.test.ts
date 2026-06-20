/**
 * RL-043 Slice A — `useNotebookRun` orchestration coverage.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/runners', () => ({
  runnerManager: {
    execute: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));

import { useNotebookRun } from '../../src/renderer/hooks/useNotebookRun';
import { runnerManager } from '../../src/renderer/runners';
import { trackEvent } from '../../src/renderer/utils/telemetry';
import {
  resetNotebookSessionsForTests,
} from '../../src/renderer/runtime/notebookSession';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../src/renderer/stores/notebookStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;
const mockStop = runnerManager.stop as unknown as ReturnType<typeof vi.fn>;
const mockTrack = trackEvent as unknown as ReturnType<typeof vi.fn>;

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

function seedPythonOnlyNotebook(tabId: string): void {
  resetNotebookStoreForTests();
  useNotebookStore.setState({
    notebooks: {
      [tabId]: {
        notebook: {
          version: 1,
          id: `notebook-${tabId}`,
          title: 'Python import',
          cells: [
            {
              kind: 'code',
              id: 'cell-python',
              language: 'python',
              source: 'print("hi")',
              outputs: [],
            },
          ],
        },
        cellRunStatus: {},
        activeCellId: 'cell-python',
      },
    },
  });
}

describe('useNotebookRun', () => {
  beforeEach(() => {
    resetNotebookSessionsForTests();
    resetNotebookStoreForTests();
    mockExecute.mockReset();
    mockStop.mockReset();
    mockTrack.mockReset();
    localStorage.clear();
    useUIStore.setState({ statusNotice: null });
  });
  afterEach(() => {
    resetNotebookSessionsForTests();
    resetNotebookStoreForTests();
    localStorage.clear();
    useUIStore.setState({ statusNotice: null });
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
  });

  it('runAll surfaces a notice instead of silently no-oping when every code cell is unsupported', async () => {
    seedPythonOnlyNotebook('tab-python');
    const { result } = renderHook(() => useNotebookRun());

    await act(async () => {
      await result.current.runAll('tab-python');
    });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'notebook.notice.languageNotSupported',
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

  it('stop signals the runner', () => {
    const { result } = renderHook(() => useNotebookRun());
    act(() => {
      result.current.stop();
    });
    expect(mockStop).toHaveBeenCalledWith('javascript');
  });
});

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

describe('useNotebookRun', () => {
  beforeEach(() => {
    resetNotebookSessionsForTests();
    resetNotebookStoreForTests();
    mockExecute.mockReset();
    mockStop.mockReset();
    mockTrack.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    resetNotebookSessionsForTests();
    resetNotebookStoreForTests();
    localStorage.clear();
  });

  it('runCell flips status to running then ok and writes outputs', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: { stdout: ['hi'], stderr: [], sessionDelta: {} },
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
      result: { stdout: [], stderr: [], sessionDelta: {} },
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
        result: { stdout: ['unused'], stderr: [], sessionDelta: {} },
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

  it('stop signals the runner', () => {
    const { result } = renderHook(() => useNotebookRun());
    act(() => {
      result.current.stop();
    });
    expect(mockStop).toHaveBeenCalledWith('javascript');
  });
});

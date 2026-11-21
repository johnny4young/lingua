import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ExecutionResult } from '@/types/execution';

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));

vi.mock('@/runners/manager', () => ({ runnerManager: { execute: mockExecute } }));

import { useStartPromptRun } from '@/components/Start/useStartPromptRun';
import { useEditorStore } from '@/stores/editorStore';
import { claimNotebookRunner, resetNotebookRunnerLocksForTests } from '@/stores/notebookRunnerLockStore';
import { useResultStore } from '@/stores/resultStore';

function valueResult(value: string): ExecutionResult {
  return { stdout: [], stderr: [], executionTime: 2, magicResults: [{ line: 1, value, kind: 'autoLog' }] };
}

/** Lets the run's awaited execute and lazy answer module settle under fake timers. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

describe('useStartPromptRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExecute.mockReset();
    mockExecute.mockImplementation(async (_language: string, code: string) => valueResult(code === '6 * 7' ? '42' : '1'));
    resetNotebookRunnerLocksForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useResultStore.setState({ isManualRunning: false, lineResults: [], fullOutput: '' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a complete JS line once it pauses for 1.2 s, in the worker with auto-log', async () => {
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1199));
    expect(mockExecute).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await settle();
    expect(mockExecute).toHaveBeenCalledWith('javascript', '6 * 7', { language: 'javascript', autoLog: true });
    expect(result.current.run).toMatchObject({ phase: 'answered', code: '6 * 7', answer: { valueKind: 'number', answer: { numeral: '42' } } });
  });

  it('leaves the global result store alone', async () => {
    const before = useResultStore.getState();
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    const after = useResultStore.getState();
    expect(after.lineResults).toBe(before.lineResults);
    expect(after.fullOutput).toBe(before.fullOutput);
  });

  it('keeps a half-typed line from running and keeps the last answer', async () => {
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    act(() => result.current.edit('6 * 7 +'));
    act(() => vi.advanceTimersByTime(5000));
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.current.run).toMatchObject({ phase: 'answered', code: '6 * 7' });
  });

  it('clears the answer when the line is emptied', async () => {
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    act(() => result.current.edit('  '));
    expect(result.current.run).toEqual({ phase: 'idle' });
  });

  it('drops an answer that a newer edit overtook', async () => {
    let finishFirst: (value: ExecutionResult) => void = () => {};
    mockExecute.mockImplementationOnce(() => new Promise<ExecutionResult>(resolve => (finishFirst = resolve)));
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('1 + 1'));
    act(() => vi.advanceTimersByTime(1200));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    finishFirst(valueResult('2'));
    await settle();
    expect(result.current.run).toMatchObject({ phase: 'answered', code: '6 * 7', answer: { answer: { numeral: '42' } } });
  });

  it('waits while a notebook cell holds the runner', async () => {
    claimNotebookRunner('javascript', 'notebook-tab');
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.current.run).toEqual({ phase: 'busy', code: '6 * 7' });
  });

  it('waits while a manual run holds the runner', async () => {
    useResultStore.setState({ isManualRunning: true });
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.current.run.phase).toBe('busy');
  });

  it('drops the answer when a notebook claimed the runner mid-run', async () => {
    let finish: (value: ExecutionResult) => void = () => {};
    mockExecute.mockImplementationOnce(() => new Promise<ExecutionResult>(resolve => (finish = resolve)));
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    claimNotebookRunner('javascript', 'notebook-tab');
    finish(valueResult('42'));
    await settle();
    expect(result.current.run).toEqual({ phase: 'busy', code: '6 * 7' });
  });

  it('keeps a JS line as a scratch tab on Enter without running it', () => {
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => result.current.submit('6 * 7'));
    act(() => vi.advanceTimersByTime(5000));
    expect(mockExecute).not.toHaveBeenCalled();
    const { tabs, activeTabId } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ language: 'javascript', content: '6 * 7' });
    expect(activeTabId).toBe(tabs[0]!.id);
  });

  it('ignores Enter on an empty line', () => {
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.submit('   '));
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it('runs Python on Enter only, then keeps it on the next Enter', async () => {
    const { result } = renderHook(() => useStartPromptRun('python'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(5000));
    expect(mockExecute).not.toHaveBeenCalled();
    act(() => result.current.submit('6 * 7'));
    await settle();
    expect(mockExecute).toHaveBeenCalledWith('python', '6 * 7', { language: 'python', autoLog: true });
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    act(() => result.current.submit('6 * 7'));
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ language: 'python', content: '6 * 7' });
  });

  it('answers with the error name when the runner throws', async () => {
    mockExecute.mockRejectedValueOnce(new TypeError('worker gone'));
    const { result } = renderHook(() => useStartPromptRun('javascript'));
    act(() => result.current.edit('6 * 7'));
    act(() => vi.advanceTimersByTime(1200));
    await settle();
    expect(result.current.run).toMatchObject({ phase: 'answered', answer: { answer: { status: 'error', label: 'TypeError' } } });
  });
});

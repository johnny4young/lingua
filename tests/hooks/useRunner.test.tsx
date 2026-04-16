import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRunner } from '@/hooks/useRunner';
import { useConsoleStore } from '@/stores/consoleStore';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import type { ExecutionResult } from '@/types';

const {
  mockPrepareRunner,
  mockIsSupported,
  mockNeedsInitialization,
} = vi.hoisted(() => ({
  mockPrepareRunner: vi.fn(),
  mockIsSupported: vi.fn(),
  mockNeedsInitialization: vi.fn(),
}));

vi.mock('@/runners', () => ({
  runnerManager: {
    prepareRunner: mockPrepareRunner,
    isSupported: mockIsSupported,
    needsInitialization: mockNeedsInitialization,
    stop: vi.fn(),
  },
}));

describe('useRunner', () => {
  const initialConsoleState = useConsoleStore.getState();
  const initialEditorState = useEditorStore.getState();
  const initialResultState = useResultStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useConsoleStore.setState(initialConsoleState, true);
    useEditorStore.setState(initialEditorState, true);
    useResultStore.setState(initialResultState, true);
    mockIsSupported.mockReturnValue(true);
    mockNeedsInitialization.mockReturnValue(false);
  });

  afterEach(() => {
    useConsoleStore.setState(initialConsoleState, true);
    useEditorStore.setState(initialEditorState, true);
    useResultStore.setState(initialResultState, true);
  });

  it('syncs dynamic manual runs into the result store', async () => {
    const result: ExecutionResult = {
      stdout: [{ type: 'log', args: ['hello'], line: 1 }],
      stderr: [{ type: 'warn', args: ['careful'], line: 2 }],
      result: 42,
      executionTime: 24,
      error: { message: 'Boom', line: 2, column: 3 },
    };

    mockPrepareRunner.mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue(result),
      },
    });

    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'main.ts',
          language: 'typescript',
          content: 'console.log("hello")\n40 + 2',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    });

    const { result: hook } = renderHook(() => useRunner());

    await act(async () => {
      await hook.current.run();
    });

    expect(useResultStore.getState().lineResults).toEqual([
      { line: 1, value: 'hello', type: 'log' },
      { line: 2, value: 'careful', type: 'warn' },
      { line: 2, value: '42', type: 'result' },
    ]);
    expect(useResultStore.getState().fullOutput).toBe('');
    expect(useResultStore.getState().error).toEqual({ message: 'Boom', line: 2, column: 3 });
    expect(useResultStore.getState().executionTime).toBe(24);
  });

  it('syncs compiled manual runs into the result store', async () => {
    mockPrepareRunner.mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['compiled ok'] }],
          stderr: [{ type: 'error', args: ['line 3 compile issue'] }],
          executionTime: 51,
          error: { message: 'Compile failed', line: 3, column: 2 },
        } satisfies ExecutionResult),
      },
    });

    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-2',
          name: 'main.rs',
          language: 'rust',
          content: 'fn main() {}',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-2',
    });

    const { result: hook } = renderHook(() => useRunner());

    await act(async () => {
      await hook.current.run();
    });

    expect(useResultStore.getState().lineResults).toEqual([]);
    // stderr entries of type 'error' are excluded from fullOutput when
    // result.error is set, so the error doesn't appear twice (once inline
    // and once in the dedicated error display).
    expect(useResultStore.getState().fullOutput).toBe('compiled ok');
    expect(useResultStore.getState().error).toEqual({
      message: 'Compile failed',
      line: 3,
      column: 2,
    });
    expect(useResultStore.getState().executionTime).toBe(51);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRunner } from '@/hooks/useRunner';
import { useConsoleStore } from '@/stores/consoleStore';
import { useEditorStore } from '@/stores/editorStore';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useLicenseStore } from '@/stores/licenseStore';
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
  const initialExecutionHistoryState = useExecutionHistoryStore.getState();
  const initialLicenseState = useLicenseStore.getState();
  const initialResultState = useResultStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useConsoleStore.setState(initialConsoleState, true);
    useEditorStore.setState(initialEditorState, true);
    useExecutionHistoryStore.setState(initialExecutionHistoryState, true);
    useLicenseStore.setState(initialLicenseState, true);
    useLicenseStore.setState({
      token: 'test.token',
      status: {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'test@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      },
      lastVerifiedAt: Date.now(),
    });
    useResultStore.setState(initialResultState, true);
    mockIsSupported.mockReturnValue(true);
    mockNeedsInitialization.mockReturnValue(false);
  });

  afterEach(() => {
    useConsoleStore.setState(initialConsoleState, true);
    useEditorStore.setState(initialEditorState, true);
    useExecutionHistoryStore.setState(initialExecutionHistoryState, true);
    useLicenseStore.setState(initialLicenseState, true);
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
    expect(useExecutionHistoryStore.getState().entries).toMatchObject([
      { language: 'typescript', status: 'error', durationMs: 24 },
    ]);
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      executionState: 'error',
      parseError: 'Boom',
    });
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
    expect(useExecutionHistoryStore.getState().entries).toMatchObject([
      { language: 'rust', status: 'error', durationMs: 51 },
    ]);
  });

  it('records successful manual runs in execution history too', async () => {
    mockPrepareRunner.mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['ok'] }],
          stderr: [],
          executionTime: 9,
          error: null,
        } satisfies ExecutionResult),
      },
    });

    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-3',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("ok")',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-3',
    });

    const { result: hook } = renderHook(() => useRunner());

    await act(async () => {
      await hook.current.run();
    });

    expect(useExecutionHistoryStore.getState().entries).toMatchObject([
      { language: 'javascript', status: 'ok', durationMs: 9 },
    ]);
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      executionState: 'success',
      parseError: null,
    });
  });

  it('can execute a replay without recording another history entry', async () => {
    mockPrepareRunner.mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['replayed'] }],
          stderr: [],
          executionTime: 11,
          error: null,
        } satisfies ExecutionResult),
      },
    });

    useEditorStore.setState({
      tabs: [
        {
          id: 'replay-tab',
          name: 'replay.js',
          language: 'javascript',
          content: 'console.log("replayed")',
          isDirty: false,
        },
      ],
      activeTabId: 'replay-tab',
    });

    const { result: hook } = renderHook(() => useRunner());

    await act(async () => {
      await hook.current.run({ recordHistory: false });
    });

    expect(useExecutionHistoryStore.getState().entries).toHaveLength(0);
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      executionState: 'success',
      parseError: null,
    });
  });

  it('does not record history or mark the tab successful when execution is stopped', async () => {
    mockPrepareRunner.mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['before stop'], line: 1 }],
          stderr: [{ type: 'error', args: ['partial stderr'], line: 2 }],
          executionTime: 0,
          cancelled: true,
          error: { message: 'Execution stopped by user.' },
        } satisfies ExecutionResult),
      },
    });

    useEditorStore.setState({
      tabs: [
        {
          id: 'stopped-tab',
          name: 'stopped.js',
          language: 'javascript',
          content: 'while (true) {}',
          isDirty: false,
        },
      ],
      activeTabId: 'stopped-tab',
    });

    const { result: hook } = renderHook(() => useRunner());

    await act(async () => {
      await hook.current.run();
    });

    expect(useExecutionHistoryStore.getState().entries).toHaveLength(0);
    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      executionState: 'idle',
      parseError: null,
    });
    expect(useConsoleStore.getState().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'log',
          content: 'before stop',
          line: 1,
        }),
        expect.objectContaining({
          type: 'error',
          content: 'partial stderr',
          line: 2,
        }),
        expect.objectContaining({
          type: 'warn',
          content: 'Execution stopped by user.',
        }),
      ])
    );
  });
});

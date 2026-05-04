import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoRun, AUTO_RUN_DEBOUNCE_MS } from '@/hooks/useAutoRun';
import { runnerManager } from '@/runners';
import { useEditorStore } from '@/stores/editorStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useResultStore } from '@/stores/resultStore';

vi.mock('@/runners', () => ({
  runnerManager: {
    prepareRunner: vi.fn(),
    isSupported: vi.fn(),
    needsInitialization: vi.fn(),
    stop: vi.fn(),
  },
}));

describe('useAutoRun', () => {
  const initialEditor = useEditorStore.getState();
  const initialLicense = useLicenseStore.getState();
  const initialResult = useResultStore.getState();
  const originalLingua = window.lingua;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useEditorStore.setState(initialEditor, true);
    useLicenseStore.setState(initialLicense, true);
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
    useResultStore.setState(initialResult, true);
    vi.mocked(runnerManager.isSupported).mockReturnValue(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useEditorStore.setState(initialEditor, true);
    useLicenseStore.setState(initialLicense, true);
    useResultStore.setState(initialResult, true);
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: originalLingua,
    });
  });

  it('does not auto-run desktop-only languages on the web build (RL-038 Slice C)', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'web' },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-go',
          name: 'main.go',
          language: 'go',
          content: 'package main\nfunc main() {}\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-go',
    });
    useResultStore.setState({
      fullOutput: 'stale output',
      executionSource: 'auto',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().fullOutput).toBe('');
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('still auto-runs desktop-only languages on the desktop build', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'darwin' },
    });
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['ok'] }],
          stderr: [],
          result: undefined,
          executionTime: 12,
          error: null,
        }),
      },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-go',
          name: 'main.go',
          language: 'go',
          content: 'package main\nfunc main() {}\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-go',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).toHaveBeenCalledWith('go');
    expect(useResultStore.getState().executionSource).toBe('auto');
  });

  it('does not let a pending auto-run cancel a manual execution', async () => {
    useResultStore.setState({ isManualRunning: true });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'while (true) {}\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('does not let an in-flight auto-run overwrite a manual execution', async () => {
    let resolveExecute!: (value: {
      stdout: Array<{ type: 'log'; args: string[] }>;
      stderr: [];
      result: undefined;
      executionTime: number;
      error: null;
    }) => void;
    const execute = vi.fn(
      () =>
        new Promise<{
          stdout: Array<{ type: 'log'; args: string[] }>;
          stderr: [];
          result: undefined;
          executionTime: number;
          error: null;
        }>((resolve) => {
          resolveExecute = resolve;
        })
    );
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'await new Promise(() => {})\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(1);

    useResultStore.setState({
      isManualRunning: true,
      executionSource: 'manual',
      fullOutput: 'manual output',
    });
    useResultStore.setState({ isManualRunning: false });

    await act(async () => {
      resolveExecute({
        stdout: [{ type: 'log', args: ['stale auto output'] }],
        stderr: [],
        result: undefined,
        executionTime: 12,
        error: null,
      });
      await Promise.resolve();
    });

    expect(useResultStore.getState().executionSource).toBe('manual');
    expect(useResultStore.getState().fullOutput).toBe('manual output');
  });

  it('does not let an older auto-run overwrite a newer auto-run', async () => {
    const resolvers: Array<
      (value: {
        stdout: Array<{ type: 'log'; args: string[] }>;
        stderr: [];
        result: undefined;
        executionTime: number;
        error: null;
      }) => void
    > = [];
    const execute = vi.fn(
      () =>
        new Promise<{
          stdout: Array<{ type: 'log'; args: string[] }>;
          stderr: [];
          result: undefined;
          executionTime: number;
          error: null;
        }>((resolve) => {
          resolvers.push(resolve);
        })
    );
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("first")\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(1);

    act(() => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-js',
            name: 'main.js',
            language: 'javascript',
            content: 'console.log("second")\n',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-js',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[1]?.({
        stdout: [{ type: 'log', args: ['second auto output'] }],
        stderr: [],
        result: undefined,
        executionTime: 9,
        error: null,
      });
      await Promise.resolve();
    });

    expect(useResultStore.getState().lineResults).toMatchObject([
      { value: 'second auto output' },
    ]);

    await act(async () => {
      resolvers[0]?.({
        stdout: [{ type: 'log', args: ['stale first output'] }],
        stderr: [],
        result: undefined,
        executionTime: 15,
        error: null,
      });
      await Promise.resolve();
    });

    expect(useResultStore.getState().lineResults).toMatchObject([
      { value: 'second auto output' },
    ]);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoRun, AUTO_RUN_DEBOUNCE_MS, bucketAutoLogCount } from '@/hooks/useAutoRun';
import { runnerManager } from '@/runners';
import { useEditorStore } from '@/stores/editorStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useResultStore } from '@/stores/resultStore';
import { useConsoleStore } from '@/stores/consoleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { loadAutoRunExecution } from '@/hooks/autoRunExecutionLoader';
import {
  claimNotebookRunner,
  resetNotebookRunnerLocksForTests,
} from '@/stores/notebookRunnerLockStore';

vi.mock('@/runners', () => ({
  runnerManager: {
    prepareRunner: vi.fn(),
    isSupported: vi.fn(),
    needsInitialization: vi.fn(),
    stop: vi.fn(),
  },
}));

function seedBrowserPreviewTab(content = 'document.body.textContent = "ready";') {
  useEditorStore.setState({
    tabs: [
      {
        id: 'tab-preview',
        name: 'preview.js',
        language: 'javascript',
        content,
        isDirty: false,
        runtimeMode: 'browser-preview',
        workflowMode: 'scratchpad',
      },
    ],
    activeTabId: 'tab-preview',
  });
}

function mockSuccessfulRunner() {
  const execute = vi.fn().mockResolvedValue({
    stdout: [],
    stderr: [],
    result: undefined,
    executionTime: 5,
    error: null,
  });
  vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
    runner: { execute },
    initialized: false,
  });
  return execute;
}

describe('useAutoRun', () => {
  const initialEditor = useEditorStore.getState();
  const initialLicense = useLicenseStore.getState();
  const initialResult = useResultStore.getState();
  const initialSettings = useSettingsStore.getState();
  const initialHistory = useExecutionHistoryStore.getState();
  const originalLingua = window.lingua;

  beforeEach(async () => {
    vi.useFakeTimers();
    await loadAutoRunExecution();
    vi.clearAllMocks();
    useEditorStore.setState(initialEditor, true);
    useLicenseStore.setState(initialLicense, true);
    useSettingsStore.setState(initialSettings, true);
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
    useExecutionHistoryStore.setState(initialHistory, true);
    resetNotebookRunnerLocksForTests();
    // pre-acknowledge native execution so the existing
    // Go/Rust auto-run cases bypass the gate. The dedicated internal
    // test below explicitly resets this to `false` to exercise the
    // gate behaviour.
    useSettingsStore.setState({ nativeExecutionAcknowledged: true });
    vi.mocked(runnerManager.isSupported).mockReturnValue(true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useEditorStore.setState(initialEditor, true);
    useLicenseStore.setState(initialLicense, true);
    useResultStore.setState(initialResult, true);
    useSettingsStore.setState(initialSettings, true);
    useExecutionHistoryStore.setState(initialHistory, true);
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: originalLingua,
    });
  });

  it('never auto-runs a persisted notebook document or interferes with its kernel', async () => {
    const execute = mockSuccessfulRunner();
    const tab = {
      id: 'saved-notebook',
      name: 'saved.linguanb',
      kind: 'notebook' as const,
      language: 'typescript' as const,
      content: 'const persisted = 42;',
      isDirty: false,
      workflowMode: 'scratchpad' as const,
    };
    useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(runnerManager.stop).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      useEditorStore.setState({ tabs: [{ ...tab, content: 'const persisted = 43;' }] });
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(runnerManager.stop).not.toHaveBeenCalled();
  });

  it('buckets auto-log counts into the telemetry allowlist', () => {
    expect(bucketAutoLogCount(0)).toBe('1');
    expect(bucketAutoLogCount(1)).toBe('1');
    expect(bucketAutoLogCount(5)).toBe('2-5');
    expect(bucketAutoLogCount(20)).toBe('6-20');
    expect(bucketAutoLogCount(21)).toBe('20-plus');
  });

  it('debounces rapid Browser preview edits into one 300 ms refresh without history', async () => {
    const execute = mockSuccessfulRunner();
    seedBrowserPreviewTab();
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 1,
    });
    const historyBefore = useExecutionHistoryStore.getState().entries;

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      const tab = useEditorStore.getState().tabs[0]!;
      useEditorStore.setState({
        tabs: [{ ...tab, content: 'document.body.textContent = "first";' }],
        activeTabId: tab.id,
      });
      await vi.advanceTimersByTimeAsync(100);
      useEditorStore.setState({
        tabs: [{ ...tab, content: 'document.body.textContent = "second";' }],
        activeTabId: tab.id,
      });
      await vi.advanceTimersByTimeAsync(299);
    });

    expect(execute).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(runnerManager.prepareRunner).toHaveBeenCalledTimes(1);
    expect(runnerManager.prepareRunner).toHaveBeenCalledWith('javascript', 'browser-preview');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(useExecutionHistoryStore.getState().entries).toEqual(historyBefore);
  });

  it('keeps the console when a live preview refresh finds no mounted panel', async () => {
    const execute = vi.fn().mockResolvedValue({
      stdout: [], stderr: [], executionTime: 0, error: null, cancelled: true, kind: 'stopped',
    });
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({ runner: { execute }, initialized: false });
    seedBrowserPreviewTab();
    useConsoleStore.getState().clear();
    useConsoleStore.getState().addEntries([{ type: 'log', args: ['kept'] } as never]);

    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(useConsoleStore.getState().entries).toHaveLength(1);
    expect(useResultStore.getState().runTermination).toBeNull();
  });

  it('names the running tab in the execution context', async () => {
    const execute = mockSuccessfulRunner();
    seedBrowserPreviewTab();

    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Runners that need workspace state (Browser preview reads sibling
    // css / html tabs) look it up by this id instead of callers seeding it.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      'document.body.textContent = "ready";',
      expect.objectContaining({ tabId: 'tab-preview' })
    );
  });

  it('Off leaves Browser preview manual-only', async () => {
    mockSuccessfulRunner();
    useSettingsStore.setState({ browserPreviewRefreshIntervalMs: 0 });
    seedBrowserPreviewTab();

    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().isAutoRunning).toBe(false);
  });

  it('a first-line 1000 override wins over the 300 ms setting', async () => {
    const execute = mockSuccessfulRunner();
    seedBrowserPreviewTab('// @preview-refresh 1000\ndocument.body.textContent = "slow";');

    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(execute).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('switching runtime cancels an in-flight Browser preview refresh', async () => {
    const execute = vi.fn(() => new Promise(() => {}));
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
      initialized: false,
    });
    seedBrowserPreviewTab();

    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(useResultStore.getState().isAutoRunning).toBe(true);

    await act(async () => {
      const tab = useEditorStore.getState().tabs[0]!;
      useEditorStore.setState({
        tabs: [{ ...tab, runtimeMode: 'worker' }],
        activeTabId: tab.id,
      });
      await Promise.resolve();
    });

    expect(runnerManager.stop).toHaveBeenCalledWith('javascript', 'browser-preview');
    expect(useResultStore.getState().isAutoRunning).toBe(false);
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('does not auto-run desktop-only languages on the web build ', async () => {
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

  it('does not auto-run a restored desktop JS mode on the web build', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'web' },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'restored-node-web',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log(1)',
          isDirty: false,
          runtimeMode: 'node',
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'restored-node-web',
    });
    renderHook(() => useAutoRun());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
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

    // prepareRunner gained an optional
    // runtimeMode arg. Non-JS/TS tabs leave runtimeMode undefined.
    expect(runnerManager.prepareRunner).toHaveBeenCalledWith('go', undefined);
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
        }>(resolve => {
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
        }>(resolve => {
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

    expect(useResultStore.getState().lineResults).toMatchObject([{ value: 'second auto output' }]);

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

    expect(useResultStore.getState().lineResults).toMatchObject([{ value: 'second auto output' }]);
  });

  it('gates an incomplete JS buffer and never calls the runner', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-incomplete',
          name: 'main.js',
          language: 'javascript',
          content: 'for (let i = ',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js-incomplete',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().autoRunGateReason).toBe('incomplete');
    expect(useResultStore.getState().isAutoRunning).toBe(false);
  });

  it('clears the gate reason when the buffer becomes complete', async () => {
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['0'] }],
          stderr: [],
          result: undefined,
          executionTime: 4,
          error: null,
        }),
      },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-complete',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log(0);',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js-complete',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).toHaveBeenCalledWith('javascript', undefined);
    expect(useResultStore.getState().autoRunGateReason).toBe('ok');
  });

  it('restores the last successful snapshot on a gated keystroke', async () => {
    // Land a real run first so the snapshot captures naturally — the
    // tab-switch useEffect intentionally clears the snapshot on
    // mount, so we cannot just seed it via setState ahead of time.
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['42'] }],
          stderr: [],
          result: undefined,
          stdinConsumed: { count: 1, total: 2 },
          executionTime: 7,
          error: null,
        }),
      },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-snapshot',
          name: 'main.js',
          language: 'javascript',
          content: 'const x = 1;',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js-snapshot',
    });

    renderHook(() => useAutoRun());

    // First debounce window: the complete buffer runs and the
    // snapshot captures.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    const snapshotAfterRun = useResultStore.getState().lastSuccessfulSnapshot;
    expect(snapshotAfterRun).not.toBeNull();
    const goodLineResults = snapshotAfterRun!.lineResults;
    expect(snapshotAfterRun!.executionTime).toBe(7);
    expect(snapshotAfterRun!.stdinConsumed).toEqual({ count: 1, total: 2 });

    // Now flip the buffer to an obviously-incomplete shape; the
    // gate should short-circuit and restore the captured snapshot.
    act(() => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-js-snapshot',
            name: 'main.js',
            language: 'javascript',
            content: 'const x = ',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-js-snapshot',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).toHaveBeenCalledTimes(1);
    expect(useResultStore.getState().autoRunGateReason).toBe('incomplete');
    expect(useResultStore.getState().lineResults).toEqual(goodLineResults);
    expect(useResultStore.getState().executionTime).toBe(7);
    expect(useResultStore.getState().stdinConsumed).toEqual({
      count: 1,
      total: 2,
    });
  });

  it('does NOT auto-run when workflow mode is `run`', async () => {
    // A complete JS buffer in Run mode must not auto-execute. The
    // user opted out of Scratchpad behavior on this tab; the only
    // way to produce output is the manual Run gesture.
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-run',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("hello");',
          isDirty: false,
          workflowMode: 'run',
        },
      ],
      activeTabId: 'tab-js-run',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().executionSource).toBeNull();
    expect(useResultStore.getState().isAutoRunning).toBe(false);
  });

  it('does NOT auto-run when workflow mode is `debug`', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-debug',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("hello");',
          isDirty: false,
          workflowMode: 'debug',
        },
      ],
      activeTabId: 'tab-js-debug',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('clears a visible Scratchpad gate when switching to Run mode', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-gated-mode-switch',
          name: 'main.js',
          language: 'javascript',
          content: 'const x = ',
          isDirty: false,
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'tab-js-gated-mode-switch',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().autoRunGateReason).toBe('incomplete');

    act(() => {
      const tab = useEditorStore.getState().tabs[0]!;
      useEditorStore.setState({
        tabs: [{ ...tab, workflowMode: 'run' }],
        activeTabId: tab.id,
      });
    });

    expect(useResultStore.getState().autoRunGateReason).toBeNull();
    expect(useResultStore.getState().isAutoRunning).toBe(false);
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('cancels an in-flight Scratchpad auto-run when switching to Run mode', async () => {
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
        }>(resolve => {
          resolveExecute = resolve;
        })
    );
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-inflight-mode-switch',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("stale auto");',
          isDirty: false,
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'tab-js-inflight-mode-switch',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(useResultStore.getState().isAutoRunning).toBe(true);
    expect(useResultStore.getState().executionSource).toBe('auto');

    act(() => {
      const tab = useEditorStore.getState().tabs[0]!;
      useEditorStore.setState({
        tabs: [{ ...tab, workflowMode: 'run' }],
        activeTabId: tab.id,
      });
    });

    expect(useResultStore.getState().isAutoRunning).toBe(false);
    expect(useResultStore.getState().executionSource).toBeNull();

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

    expect(useResultStore.getState().lineResults).toEqual([]);
    expect(useResultStore.getState().fullOutput).toBe('');
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('cancels an in-flight Scratchpad auto-run when the buffer becomes empty', async () => {
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
        }>(resolve => {
          resolveExecute = resolve;
        })
    );
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-empty-inflight',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("pending");',
          isDirty: false,
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'tab-js-empty-inflight',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(useResultStore.getState().isAutoRunning).toBe(true);
    expect(useResultStore.getState().executionSource).toBe('auto');

    act(() => {
      const tab = useEditorStore.getState().tabs[0]!;
      useEditorStore.setState({
        tabs: [{ ...tab, content: '' }],
        activeTabId: tab.id,
      });
    });

    expect(useResultStore.getState().isAutoRunning).toBe(false);
    expect(useResultStore.getState().executionSource).toBeNull();

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

    expect(useResultStore.getState().lineResults).toEqual([]);
    expect(useResultStore.getState().fullOutput).toBe('');
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  it('still auto-runs (and gates) when workflow mode is `scratchpad`', async () => {
    // Sanity check that the workflow-mode short-circuit doesn't
    // accidentally suppress Scratchpad-mode auto-run.
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: {
        execute: vi.fn().mockResolvedValue({
          stdout: [{ type: 'log', args: ['7'] }],
          stderr: [],
          result: undefined,
          executionTime: 3,
          error: null,
        }),
      },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-scratch',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log(7);',
          isDirty: false,
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'tab-js-scratch',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).toHaveBeenCalledWith('javascript', undefined);
  });

  it('re-runs the same Scratchpad buffer when auto-log is toggled', async () => {
    const execute = vi.fn().mockResolvedValue({
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 3,
      error: null,
    });
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
    });
    useSettingsStore.setState({
      scratchpadAutoLogByLanguage: { javascript: false, typescript: false },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-auto-log-toggle',
          name: 'main.js',
          language: 'javascript',
          content: 'const x = 1;\nx + 1',
          isDirty: false,
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'tab-js-auto-log-toggle',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenLastCalledWith('const x = 1;\nx + 1', {
      autoLog: false,
      language: 'javascript',
      tabId: 'tab-js-auto-log-toggle',
      // auto-run requests a scope capture for
      // inspector-supported languages so the toggle lights up on
      // the first clean run.
      captureScope: true,
      scopeDepth: 1,
    });

    act(() => {
      useSettingsStore.setState({
        scratchpadAutoLogByLanguage: {
          javascript: true,
          typescript: false,
        },
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith('const x = 1;\nx + 1', {
      autoLog: true,
      language: 'javascript',
      tabId: 'tab-js-auto-log-toggle',
      captureScope: true,
      scopeDepth: 1,
    });
  });

  it('re-runs the same Scratchpad buffer when stdin changes', async () => {
    const execute = vi.fn().mockResolvedValue({
      stdout: [],
      stderr: [],
      result: undefined,
      executionTime: 3,
      error: null,
      stdinConsumed: { count: 1, total: 1 },
    });
    vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
      runner: { execute },
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js-stdin-toggle',
          name: 'main.js',
          language: 'javascript',
          content: 'prompt()',
          isDirty: false,
          workflowMode: 'scratchpad',
        },
      ],
      activeTabId: 'tab-js-stdin-toggle',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenLastCalledWith('prompt()', {
      autoLog: true,
      language: 'javascript',
      tabId: 'tab-js-stdin-toggle',
      captureScope: true,
      scopeDepth: 1,
    });

    act(() => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-js-stdin-toggle',
            name: 'main.js',
            language: 'javascript',
            content: 'prompt()',
            isDirty: false,
            workflowMode: 'scratchpad',
            stdinBuffer: 'Ada',
          },
        ],
        activeTabId: 'tab-js-stdin-toggle',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith('prompt()', {
      autoLog: true,
      language: 'javascript',
      tabId: 'tab-js-stdin-toggle',
      stdin: 'Ada',
      captureScope: true,
      scopeDepth: 1,
    });
    expect(useResultStore.getState().stdinConsumed).toEqual({
      count: 1,
      total: 1,
    });
  });

  it('does NOT auto-run Go when native execution is unacknowledged', async () => {
    // The trust-boundary modal lives behind manual Run; auto-run on a
    // Go tab the user never opted into would silently invoke the
    // host toolchain. The gate must short-circuit before
    // `prepareRunner` is even reached.
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: { platform: 'darwin' },
    });
    useSettingsStore.setState({ nativeExecutionAcknowledged: false });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-go-unacked',
          name: 'main.go',
          language: 'go',
          content: 'package main\nfunc main() {}\n',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-go-unacked',
    });

    renderHook(() => useAutoRun());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
    });

    expect(runnerManager.prepareRunner).not.toHaveBeenCalled();
    expect(useResultStore.getState().executionSource).toBeNull();
  });

  describe('in-flight run ownership', () => {
    function deferredRunner() {
      let resolveRun!: (result: unknown) => void;
      const execute = vi.fn(
        () => new Promise(resolve => {
          resolveRun = resolve;
        })
      );
      vi.mocked(runnerManager.prepareRunner).mockResolvedValue({
        runner: { execute },
        initialized: false,
      } as never);
      return { execute, resolve: (result: unknown) => resolveRun(result) };
    }

    const scratchpadTab = (id: string, content: string) => ({
      id,
      name: `${id}.js`,
      language: 'javascript' as const,
      content,
      isDirty: true,
      runtimeMode: 'worker' as const,
      workflowMode: 'scratchpad' as const,
    });

    it('keeps the run when the tab is replaced with the same input', async () => {
      const run = deferredRunner();
      useEditorStore.setState({ tabs: [scratchpadTab('same', '1 + 1')], activeTabId: 'same' });
      renderHook(() => useAutoRun());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(run.execute).toHaveBeenCalledOnce();

      act(() => {
        // A save commit and arming a one-shot timeout both replace the tab object.
        useEditorStore.setState(state => ({
          tabs: state.tabs.map(tab => ({ ...tab, isDirty: false })),
        }));
        useEditorStore.getState().setTabNextRunTimeoutOverride('same', 60_000);
      });
      await act(async () => {
        run.resolve({ stdout: [{ type: 'log', args: ['2'], line: 1 }], stderr: [], executionTime: 1 });
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS * 2);
      });

      expect(run.execute).toHaveBeenCalledOnce();
      expect(useResultStore.getState().lineResults).toEqual([{ line: 1, type: 'log', value: '2' }]);
      expect(useResultStore.getState().isAutoRunning).toBe(false);
    });

    it('auto-runs a tab switched to during a manual run once that run releases', async () => {
      const execute = mockSuccessfulRunner();
      useEditorStore.setState({
        tabs: [
          { ...scratchpadTab('manual', 'console.log(1)'), workflowMode: 'run' as const },
          scratchpadTab('scratch', '1 + 1'),
        ],
        activeTabId: 'manual',
      });
      useResultStore.setState({ isManualRunning: true });
      renderHook(() => useAutoRun());
      act(() => {
        useEditorStore.setState({ activeTabId: 'scratch' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(execute).not.toHaveBeenCalled();

      act(() => {
        useResultStore.setState({ isManualRunning: false });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith('1 + 1', expect.objectContaining({ tabId: 'scratch' }));
    });

    it('waits for a notebook Python cell to release the runner, then auto-runs', async () => {
      const execute = mockSuccessfulRunner();
      useEditorStore.setState({
        tabs: [{ ...scratchpadTab('py', 'print(1)'), name: 'py.py', language: 'python' as const }],
        activeTabId: 'py',
      });
      const release = claimNotebookRunner('python', 'notebook-tab')!;
      renderHook(() => useAutoRun());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS * 3);
      });
      expect(execute).not.toHaveBeenCalled();
      expect(runnerManager.stop).not.toHaveBeenCalled();

      act(() => {
        release();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS * 3);
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith('print(1)', expect.objectContaining({ tabId: 'py' }));
    });

    it('ignores a notebook claim on a different runner', async () => {
      const execute = mockSuccessfulRunner();
      useEditorStore.setState({ tabs: [scratchpadTab('js', '1 + 1')], activeTabId: 'js' });
      const release = claimNotebookRunner('python', 'notebook-tab')!;
      renderHook(() => useAutoRun());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(execute).toHaveBeenCalledOnce();
      release();
    });

    it('discards and reruns an auto-run a notebook cell preempted mid-flight', async () => {
      const run = deferredRunner();
      useEditorStore.setState({ tabs: [scratchpadTab('pre', '2 + 2')], activeTabId: 'pre' });
      renderHook(() => useAutoRun());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(run.execute).toHaveBeenCalledOnce();

      const release = claimNotebookRunner('javascript', 'notebook-tab')!;
      await act(async () => {
        run.resolve({ stdout: [], stderr: [], executionTime: 0, cancelled: true, kind: 'stopped' });
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS * 3);
      });
      expect(run.execute).toHaveBeenCalledOnce();
      expect(useResultStore.getState().runTermination).toBeNull();
      expect(useResultStore.getState().isAutoRunning).toBe(false);

      act(() => {
        release();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(run.execute).toHaveBeenCalledTimes(2);
    });

    it('leaves the countdown and pill of a manual run that preempted it', async () => {
      const run = deferredRunner();
      useEditorStore.setState({ tabs: [scratchpadTab('pill', 'while (x) {}')], activeTabId: 'pill' });
      renderHook(() => useAutoRun());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_RUN_DEBOUNCE_MS + 50);
      });
      expect(run.execute).toHaveBeenCalledOnce();

      const manualDeadline = Date.now() + 30_000;
      act(() => {
        useResultStore.setState({
          isManualRunning: true,
          runDeadlineAt: manualDeadline,
          runTermination: null,
        });
      });
      await act(async () => {
        run.resolve({
          stdout: [],
          stderr: [],
          executionTime: 0,
          cancelled: true,
          kind: 'stopped',
          error: { message: 'stopped' },
        });
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(useResultStore.getState().runDeadlineAt).toBe(manualDeadline);
      expect(useResultStore.getState().runTermination).toBeNull();
    });
  });
});

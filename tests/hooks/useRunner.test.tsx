import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { useRunner } from '@/hooks/useRunner';
import { useAnnouncerStore } from '@/stores/announcerStore';
import { useConsoleStore } from '@/stores/consoleStore';
import { useEditorStore } from '@/stores/editorStore';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useNativeExecutionGateStore } from '@/stores/nativeExecutionGateStore';
import { useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
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
  const initialUIState = useUIStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useAnnouncerStore.setState({ message: '', nonce: 0 });
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
    useUIStore.setState({ statusNotice: null });
    // RL-079 — pre-acknowledge native execution by default so the
    // existing Rust/Go test cases bypass the gate. The dedicated
    // RL-079 describe block resets this to `false` to exercise the
    // gate behaviour.
    useSettingsStore.setState({ nativeExecutionAcknowledged: true });
    useNativeExecutionGateStore.setState(
      { pendingLanguage: null, pendingResume: null },
      false
    );
    mockIsSupported.mockReturnValue(true);
    mockNeedsInitialization.mockReturnValue(false);
  });

  afterEach(() => {
    useConsoleStore.setState(initialConsoleState, true);
    useEditorStore.setState(initialEditorState, true);
    useExecutionHistoryStore.setState(initialExecutionHistoryState, true);
    useLicenseStore.setState(initialLicenseState, true);
    useResultStore.setState(initialResultState, true);
    useUIStore.setState(initialUIState, true);
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

  it('does not route notebook tabs through the file runner', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'notebook-tab',
          name: 'Analysis.linguanb',
          language: 'javascript',
          content: '',
          isDirty: false,
          kind: 'notebook',
        },
      ],
      activeTabId: 'notebook-tab',
    });

    const { result: hook } = renderHook(() => useRunner());

    await act(async () => {
      await hook.current.run();
    });

    expect(mockPrepareRunner).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'notebook.notice.useNotebookToolbar',
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

  describe('RL-079 native-execution gate', () => {
    const initialGateState = useNativeExecutionGateStore.getState();
    const initialSettings = useSettingsStore.getState();

    beforeEach(() => {
      useNativeExecutionGateStore.setState(initialGateState, true);
      useSettingsStore.setState(
        { ...initialSettings, nativeExecutionAcknowledged: false },
        true
      );
    });

    afterEach(() => {
      useNativeExecutionGateStore.setState(initialGateState, true);
      useSettingsStore.setState(initialSettings, true);
    });

    it('opens the gate without invoking the runner when Go is unacknowledged', async () => {
      const execute = vi.fn();
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-go',
            name: 'main.go',
            language: 'go',
            content: 'package main',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-go',
      });

      const { result: hook } = renderHook(() => useRunner());

      await act(async () => {
        await hook.current.run();
      });

      expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('go');
      expect(execute).not.toHaveBeenCalled();
    });

    it('skips the gate when Rust is already acknowledged', async () => {
      useSettingsStore.setState({ nativeExecutionAcknowledged: true });
      const execute = vi.fn().mockResolvedValue({
        stdout: [],
        stderr: [],
        executionTime: 1,
      } satisfies ExecutionResult);
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-rust',
            name: 'main.rs',
            language: 'rust',
            content: 'fn main() {}',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-rust',
      });

      const { result: hook } = renderHook(() => useRunner());

      await act(async () => {
        await hook.current.run();
      });

      expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
      expect(execute).toHaveBeenCalledOnce();
    });

    it('re-opens the gate after the user resets the acknowledgement', async () => {
      const execute = vi.fn().mockResolvedValue({
        stdout: [],
        stderr: [],
        executionTime: 1,
      } satisfies ExecutionResult);
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-go',
            name: 'main.go',
            language: 'go',
            content: 'package main',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-go',
      });

      const { result: hook } = renderHook(() => useRunner());

      // First run: gate opens.
      await act(async () => {
        await hook.current.run();
      });
      expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('go');

      // Acknowledge → resume runs.
      useSettingsStore.getState().setNativeExecutionAcknowledged(true);
      await act(async () => {
        useNativeExecutionGateStore.getState().confirm();
      });
      expect(execute).toHaveBeenCalledOnce();

      // Reset the acknowledgement → next run opens the gate again.
      useSettingsStore.getState().setNativeExecutionAcknowledged(false);
      await act(async () => {
        await hook.current.run();
      });
      expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('go');
      expect(execute).toHaveBeenCalledOnce();
    });

    it('does not gate non-native languages (JS / TS / Python)', async () => {
      const execute = vi.fn().mockResolvedValue({
        stdout: [],
        stderr: [],
        executionTime: 1,
      } satisfies ExecutionResult);
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-js',
            name: 'main.js',
            language: 'javascript',
            content: 'console.log(1)',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-js',
      });

      const { result: hook } = renderHook(() => useRunner());

      await act(async () => {
        await hook.current.run();
      });

      expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
      expect(execute).toHaveBeenCalledOnce();
    });

    it('does not show the native trust modal for Go in web builds', async () => {
      const originalLingua = window.lingua;
      window.lingua = {
        ...(originalLingua ?? ({} as LinguaAPI)),
        platform: 'web',
      } as typeof window.lingua;

      const execute = vi.fn().mockResolvedValue({
        stdout: [],
        stderr: [],
        executionTime: 1,
      } satisfies ExecutionResult);
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-go-web',
            name: 'main.go',
            language: 'go',
            content: 'package main',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-go-web',
      });

      try {
        const { result: hook } = renderHook(() => useRunner());

        await act(async () => {
          await hook.current.run();
        });

        expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
        expect(execute).toHaveBeenCalledOnce();
      } finally {
        window.lingua = originalLingua;
      }
    });

    it('opens the gate for system Ruby on desktop when unacknowledged', async () => {
      const originalLingua = window.lingua;
      window.lingua = {
        ...(originalLingua ?? ({} as LinguaAPI)),
        platform: 'darwin',
        ruby: {
          detect: vi.fn(),
          run: vi.fn(),
          stop: vi.fn(),
        },
      } as typeof window.lingua;

      const execute = vi.fn().mockResolvedValue({
        stdout: [],
        stderr: [],
        executionTime: 1,
      } satisfies ExecutionResult);
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });
      useSettingsStore.setState({ rubyRuntimePreference: 'auto' });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-ruby-system',
            name: 'main.rb',
            language: 'ruby',
            content: 'puts "ok"',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-ruby-system',
      });

      try {
        const { result: hook } = renderHook(() => useRunner());

        await act(async () => {
          await hook.current.run();
        });

        expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('ruby');
        expect(execute).not.toHaveBeenCalled();
      } finally {
        window.lingua = originalLingua;
      }
    });

    it('skips the native gate for Ruby when the WASM runtime is forced', async () => {
      const originalLingua = window.lingua;
      window.lingua = {
        ...(originalLingua ?? ({} as LinguaAPI)),
        platform: 'darwin',
        ruby: {
          detect: vi.fn(),
          run: vi.fn(),
          stop: vi.fn(),
        },
      } as typeof window.lingua;

      const execute = vi.fn().mockResolvedValue({
        stdout: [],
        stderr: [],
        executionTime: 1,
      } satisfies ExecutionResult);
      mockPrepareRunner.mockResolvedValue({ runner: { execute } });
      useSettingsStore.setState({ rubyRuntimePreference: 'wasm' });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-ruby-wasm',
            name: 'main.rb',
            language: 'ruby',
            content: 'puts "ok"',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-ruby-wasm',
      });

      try {
        const { result: hook } = renderHook(() => useRunner());

        await act(async () => {
          await hook.current.run();
        });

        expect(useNativeExecutionGateStore.getState().pendingLanguage).toBeNull();
        expect(execute).toHaveBeenCalledOnce();
      } finally {
        window.lingua = originalLingua;
      }
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

  // UX Sweep T9 — the console is silent to screen readers; a finished run must
  // push exactly one coalesced summary into the shared live region.
  describe('screen-reader run summary (UX Sweep T9)', () => {
    it('announces a coalesced output summary after a successful run', async () => {
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
            id: 'tab-ok',
            name: 'main.js',
            language: 'javascript',
            content: 'console.log("ok")',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-ok',
      });

      const { result: hook } = renderHook(() => useRunner());
      await act(async () => {
        await hook.current.run();
      });

      const expected = i18next.t('console.run.announce.ok', {
        count: useConsoleStore.getState().entries.length,
      });
      expect(useAnnouncerStore.getState().message).toBe(expected);
      expect(useAnnouncerStore.getState().nonce).toBe(1);
    });

    it('announces a failure summary when the run errors', async () => {
      mockPrepareRunner.mockResolvedValue({
        runner: {
          execute: vi.fn().mockResolvedValue({
            stdout: [],
            stderr: [{ type: 'error', args: ['boom'] }],
            executionTime: 3,
            error: { message: 'Boom', line: 1, column: 1 },
          } satisfies ExecutionResult),
        },
      });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-err',
            name: 'main.js',
            language: 'javascript',
            content: 'throw new Error("Boom")',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-err',
      });

      const { result: hook } = renderHook(() => useRunner());
      await act(async () => {
        await hook.current.run();
      });

      expect(useAnnouncerStore.getState().message).toBe(
        i18next.t('console.run.announce.error')
      );
    });

    it('announces a stopped summary when execution is cancelled', async () => {
      mockPrepareRunner.mockResolvedValue({
        runner: {
          execute: vi.fn().mockResolvedValue({
            stdout: [],
            stderr: [],
            executionTime: 0,
            cancelled: true,
            error: { message: 'Execution stopped by user.' },
          } satisfies ExecutionResult),
        },
      });

      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-stop',
            name: 'main.js',
            language: 'javascript',
            content: 'while (true) {}',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-stop',
      });

      const { result: hook } = renderHook(() => useRunner());
      await act(async () => {
        await hook.current.run();
      });

      expect(useAnnouncerStore.getState().message).toBe(
        i18next.t('console.run.announce.stopped')
      );
    });
  });
});

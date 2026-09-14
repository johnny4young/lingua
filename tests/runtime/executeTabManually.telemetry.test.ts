/**
 * internal — runner.executed telemetry wiring.
 *
 * These tests isolate `executeTabManually` behind hoisted mocks for
 * `runnerManager`, the telemetry emitter, and the console + result
 * stores, then assert the `runner.executed` event fires with the
 * correct payload shape on both the success and the failure branches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTrackEvent,
  mockRunnerManagerPrepare,
  mockRunnerExecute,
  mockNeedsInitialization,
  mockSetRunTermination,
  mockSetRunDeadlineAt,
} = vi.hoisted(
  () => ({
    mockTrackEvent: vi.fn().mockResolvedValue(undefined),
    mockRunnerManagerPrepare: vi.fn(),
    mockRunnerExecute: vi.fn(),
    mockNeedsInitialization: vi.fn(() => false),
    mockSetRunTermination: vi.fn(),
    mockSetRunDeadlineAt: vi.fn(),
  })
);

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

vi.mock('../../src/renderer/runners', () => ({
  runnerManager: {
    prepareRunner: mockRunnerManagerPrepare,
    isSupported: () => true,
    needsInitialization: mockNeedsInitialization,
  },
}));

vi.mock('../../src/renderer/stores/consoleStore', () => {
  const state = { addEntry: vi.fn(), addEntries: vi.fn(), clear: vi.fn() };
  return {
    useConsoleStore: {
      getState: () => state,
    },
  };
});

vi.mock('../../src/renderer/stores/resultStore', () => {
  const state = {
    clear: vi.fn(),
    clearVisibleResults: vi.fn(),
    setError: vi.fn(),
    setExecutionTime: vi.fn(),
    setExecutionSource: vi.fn(),
    setFullOutput: vi.fn(),
    setIsAutoRunning: vi.fn(),
    setIsManualRunning: vi.fn(),
    setLineResults: vi.fn(),
    setLineTimings: vi.fn(),
    setStdinConsumed: vi.fn(),
    setDiagnostics: vi.fn(),
    // implementation — pill state setters; consumers must mock them
    // or `executeTabManually` will throw `setRunDeadlineAt is not a
    // function` on the result-store destructure.
    setRunTermination: mockSetRunTermination,
    setRunDeadlineAt: mockSetRunDeadlineAt,
    // implementation — manual Run captures the snapshot on clean
    // success. Mocked as vi.fn() so the telemetry tests don't crash
    // when the new capture branch fires.
    captureSuccessfulSnapshot: vi.fn(),
    // implementation — manual Run also writes the variable inspector
    // snapshot on the clean-success branch. Mocked so the
    // destructure doesn't crash.
    setScopeSnapshot: vi.fn(),
  };
  return {
    useResultStore: {
      getState: () => state,
    },
  };
});

vi.mock('../../src/renderer/validation', () => ({
  validateDocument: vi.fn(() => []),
}));

vi.mock('../../src/renderer/hooks/runnerOutput', async importOriginal => ({
  // Keep the real per-output mapper the streamed and cancelled paths share.
  ...(await importOriginal<typeof import('../../src/renderer/hooks/runnerOutput')>()),
  getCompilationLoadingMessage: () => null,
  getCompilationMessage: () => null,
  getInitializationMessage: (language: string) => `Loading ${language}`,
  toConsoleEntries: () => [],
}));

vi.mock('../../src/renderer/utils/executionPresentation', () => ({
  toExecutionPresentation: () => ({ lineResults: [], fullOutput: '' }),
}));

vi.mock('../../src/renderer/utils/executionDiagnostics', () => ({
  toExecutionDiagnostics: () => [],
}));

import { executeTabManually } from '../../src/renderer/runtime/executeTabManually';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import type { FileTab } from '../../src/renderer/types/editor';
import { defaultRuntimeTimeoutPresetSeed } from '../../src/shared/runtimeTimeoutPresets';

describe('executeTabManually — runner.executed telemetry', () => {
  const initialEditor = useEditorStore.getState();
  const initialHistory = useExecutionHistoryStore.getState();
  const initialSettings = useSettingsStore.getState();

  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockRunnerManagerPrepare.mockReset();
    mockRunnerExecute.mockReset();
    mockNeedsInitialization.mockReset();
    mockNeedsInitialization.mockReturnValue(false);
    mockSetRunTermination.mockClear();
    mockSetRunDeadlineAt.mockClear();
    useSettingsStore.setState({
      runtimeTimeoutPresetByLanguage: defaultRuntimeTimeoutPresetSeed(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockTrackEvent.mockReset().mockResolvedValue(undefined);
    useEditorStore.setState(initialEditor, true);
    useExecutionHistoryStore.setState(initialHistory, true);
    useSettingsStore.setState(initialSettings, true);
  });

  it('fires runner.executed with status=ok and a bucketed duration on success', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 42,
          error: undefined,
        }),
      },
      initialized: false,
    });

    await executeTabManually({
      id: 'tab-1',
      name: 'main.js',
      language: 'javascript',
      content: 'console.log("hi")',
      isDirty: false,
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'runner.executed',
      expect.objectContaining({
        language: 'javascript',
        status: 'ok',
        durationBucketMs: expect.any(Number),
      })
    );
    expect(mockRunnerExecute).toHaveBeenCalledWith(
      'console.log("hi")',
      expect.objectContaining({
        tabId: 'tab-1',
        onConsole: expect.any(Function),
      })
    );
  });

  it('passes timeout and tab id into the runner context', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 42,
          error: undefined,
        }),
      },
      initialized: false,
    });

    await executeTabManually(
      {
        id: 'tab-debug',
        name: 'debug.js',
        language: 'javascript',
        content: 'const value = 1;',
        isDirty: false,
      },
      { executionTimeoutMs: 1234 }
    );

    expect(mockRunnerExecute).toHaveBeenCalledWith(
      'const value = 1;',
      expect.objectContaining({
        timeout: 1234,
        tabId: 'tab-debug',
        onConsole: expect.any(Function),
      })
    );
  });

  it('arms the countdown deadline from the settings preset on manual runs without overrides', async () => {
    const now = new Date('2026-05-14T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    useSettingsStore.setState({
      runtimeTimeoutPresetByLanguage: {
        ...defaultRuntimeTimeoutPresetSeed(),
        javascript: 'quick',
      },
    });
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 42,
          error: undefined,
        }),
      },
      initialized: false,
    });

    await executeTabManually({
      id: 'tab-countdown',
      name: 'main.js',
      language: 'javascript',
      content: 'while (true) {}',
      isDirty: false,
    });

    expect(mockRunnerExecute).toHaveBeenCalledWith(
      'while (true) {}',
      expect.objectContaining({
        tabId: 'tab-countdown',
        onConsole: expect.any(Function),
      })
    );
    expect(mockSetRunDeadlineAt).toHaveBeenNthCalledWith(
      1,
      now.getTime() + 5_000
    );
    expect(mockSetRunDeadlineAt).toHaveBeenLastCalledWith(null);
  });

  it('passes debug intent only when the caller asks for a debug run', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 42,
          error: undefined,
        }),
      },
      initialized: false,
    });

    await executeTabManually(
      {
        id: 'tab-debug',
        name: 'debug.js',
        language: 'javascript',
        content: 'const value = 1;',
        isDirty: false,
      },
      { debug: true }
    );

    expect(mockRunnerExecute).toHaveBeenCalledWith(
      'const value = 1;',
      expect.objectContaining({
        tabId: 'tab-debug',
        debug: true,
        onConsole: expect.any(Function),
      })
    );
  });

  it('fires runner.executed with status=error when the runner surfaces an error', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 12,
          error: { message: 'boom' },
        }),
      },
      initialized: false,
    });

    await executeTabManually({
      id: 'tab-2',
      name: 'main.py',
      language: 'python',
      content: 'print(oops)',
      isDirty: false,
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'runner.executed',
      expect.objectContaining({
        language: 'python',
        status: 'error',
      })
    );
  });

  it('fires runner.executed with status=error and durationBucketMs=0 when the runner throws before finishing', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockRejectedValue(new Error('init blew up')),
      },
      initialized: false,
    });

    await executeTabManually({
      id: 'tab-3',
      name: 'main.rs',
      language: 'rust',
      content: 'fn main() {}',
      isDirty: false,
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'runner.executed',
      expect.objectContaining({
        language: 'rust',
        status: 'error',
        durationBucketMs: 0,
      })
    );
  });

  it('does not emit runner.executed telemetry for user-cancelled runs', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 0,
          cancelled: true,
          error: { message: 'Execution stopped by user.' },
        }),
      },
      initialized: false,
    });

    await executeTabManually({
      id: 'tab-4',
      name: 'main.js',
      language: 'javascript',
      content: 'while (true) {}',
      isDirty: false,
    });

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  describe('ordering the orchestrator preserves', () => {
    const overrideTab: FileTab = {
      id: 'tab-override',
      name: 'main.py',
      language: 'python',
      content: 'print(1)',
      isDirty: false,
      nextRunTimeoutOverrideMs: 60_000,
    };
    const storedOverride = () =>
      useEditorStore.getState().tabs.find(tab => tab.id === overrideTab.id)
        ?.nextRunTimeoutOverrideMs;

    it.each([
      ['returns no runner', () =>
        mockRunnerManagerPrepare.mockResolvedValue({ runner: null, initialized: false })],
      ['throws', () => mockRunnerManagerPrepare.mockRejectedValue(new Error('boot failed'))],
    ] as const)(
      'keeps the one-shot timeout override when preparation %s',
      async (_label, arrangePreparation) => {
        useEditorStore.setState({ tabs: [overrideTab], activeTabId: overrideTab.id });
        arrangePreparation();

        await executeTabManually(overrideTab);

        // The user's extended timeout survives for the retry.
        expect(storedOverride()).toBe(60_000);
      }
    );

    it('consumes the one-shot timeout override once the runner is prepared', async () => {
      useEditorStore.setState({ tabs: [overrideTab], activeTabId: overrideTab.id });
      mockRunnerManagerPrepare.mockResolvedValue({
        runner: {
          execute: mockRunnerExecute.mockResolvedValue({
            stdout: [],
            stderr: [],
            result: undefined,
            executionTime: 1,
          }),
        },
        initialized: false,
      });

      await executeTabManually(overrideTab);

      expect(mockRunnerExecute).toHaveBeenCalledWith(
        'print(1)',
        expect.objectContaining({ timeout: 60_000 })
      );
      expect(storedOverride()).toBeUndefined();
    });

    it('reports a failed preparation to history and runner.executed before the bootstrap failure', async () => {
      const order: string[] = [];
      mockNeedsInitialization.mockReturnValue(true);
      mockTrackEvent.mockImplementation(async (event: string) => {
        order.push(event);
      });
      const record = vi
        .spyOn(useExecutionHistoryStore.getState(), 'record')
        .mockImplementation(() => {
          order.push('history');
        });
      mockRunnerManagerPrepare.mockRejectedValue(new Error('boot failed'));

      await executeTabManually({
        id: 'tab-order',
        name: 'main.py',
        language: 'python',
        content: 'print(1)',
        isDirty: false,
      });

      expect(record).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['history', 'runner.executed', 'runtime.bootstrap_failed']);
    });

    it('reads settings after the runner is prepared', async () => {
      useSettingsStore.setState({ showLineTiming: false });
      let finishPreparation!: (value: unknown) => void;
      mockRunnerManagerPrepare.mockReturnValue(
        new Promise(resolve => {
          finishPreparation = resolve;
        })
      );
      mockRunnerExecute.mockResolvedValue({
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 1,
      });

      const run = executeTabManually({
        id: 'tab-settings',
        name: 'main.js',
        language: 'javascript',
        content: 'console.log(1)',
        isDirty: false,
      });
      await vi.waitFor(() => expect(mockRunnerManagerPrepare).toHaveBeenCalled());
      // A setting changed while the runtime boots applies to this run.
      useSettingsStore.setState({ showLineTiming: true });
      finishPreparation({ runner: { execute: mockRunnerExecute }, initialized: true });
      await run;

      expect(mockRunnerExecute).toHaveBeenCalledWith(
        'console.log(1)',
        expect.objectContaining({ lineTiming: true })
      );
    });
  });

  it('emits one completed bootstrap outcome and closes the loading lifecycle', async () => {
    mockNeedsInitialization.mockReturnValue(true);
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 1,
        }),
      },
      initialized: true,
    });
    const setIsInitializing = vi.fn();
    const setLoadingMessage = vi.fn();

    await executeTabManually(
      {
        id: 'tab-python-bootstrap',
        name: 'main.py',
        language: 'python',
        content: 'print(42)',
        isDirty: false,
      },
      { setIsInitializing, setLoadingMessage }
    );

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'runtime.bootstrap_completed',
      expect.objectContaining({
        language: 'python',
        durationBucket: expect.any(String),
      })
    );
    expect(
      mockTrackEvent.mock.calls.filter(
        ([event]) => event === 'runtime.bootstrap_completed'
      )
    ).toHaveLength(1);
    expect(setIsInitializing).toHaveBeenCalledWith(true);
    expect(setIsInitializing).toHaveBeenLastCalledWith(false);
    expect(setLoadingMessage).toHaveBeenLastCalledWith(null);
  });

  it('emits one failed bootstrap outcome when preparation returns no runner', async () => {
    mockNeedsInitialization.mockReturnValue(true);
    mockRunnerManagerPrepare.mockResolvedValue({ runner: null, initialized: false });

    await executeTabManually({
      id: 'tab-ruby-bootstrap',
      name: 'main.rb',
      language: 'ruby',
      content: 'puts 42',
      isDirty: false,
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'runtime.bootstrap_failed',
      { language: 'ruby', reason: 'prepare-error' }
    );
    expect(
      mockTrackEvent.mock.calls.filter(
        ([event]) => event === 'runtime.bootstrap_failed'
      )
    ).toHaveLength(1);
  });
});

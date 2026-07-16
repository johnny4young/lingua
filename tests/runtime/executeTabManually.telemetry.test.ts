/**
 * RL-065 — runner.executed telemetry wiring.
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
  mockSetRunTermination,
  mockSetRunDeadlineAt,
} = vi.hoisted(
  () => ({
    mockTrackEvent: vi.fn().mockResolvedValue(undefined),
    mockRunnerManagerPrepare: vi.fn(),
    mockRunnerExecute: vi.fn(),
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
    needsInitialization: () => false,
  },
}));

vi.mock('../../src/renderer/stores/consoleStore', () => {
  const state = { addEntry: vi.fn(), clear: vi.fn() };
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
    // RL-020 Slice 7 — pill state setters; consumers must mock them
    // or `executeTabManually` will throw `setRunDeadlineAt is not a
    // function` on the result-store destructure.
    setRunTermination: mockSetRunTermination,
    setRunDeadlineAt: mockSetRunDeadlineAt,
    // RL-020 Slice 8 — manual Run captures the snapshot on clean
    // success. Mocked as vi.fn() so the telemetry tests don't crash
    // when the new capture branch fires.
    captureSuccessfulSnapshot: vi.fn(),
    // RL-020 Slice 9 — manual Run also writes the variable inspector
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

vi.mock('../../src/renderer/hooks/runnerOutput', () => ({
  getCompilationLoadingMessage: () => null,
  getCompilationMessage: () => null,
  getInitializationMessage: () => null,
  toConsoleEntries: () => [],
}));

vi.mock('../../src/renderer/utils/executionPresentation', () => ({
  toExecutionPresentation: () => ({ lineResults: [], fullOutput: '' }),
}));

vi.mock('../../src/renderer/utils/executionDiagnostics', () => ({
  toExecutionDiagnostics: () => [],
}));

import { executeTabManually } from '../../src/renderer/runtime/executeTabManually';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { defaultRuntimeTimeoutPresetSeed } from '../../src/shared/runtimeTimeoutPresets';

describe('executeTabManually — runner.executed telemetry (RL-065)', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockRunnerManagerPrepare.mockReset();
    mockRunnerExecute.mockReset();
    mockSetRunTermination.mockClear();
    mockSetRunDeadlineAt.mockClear();
    useSettingsStore.setState({
      runtimeTimeoutPresetByLanguage: defaultRuntimeTimeoutPresetSeed(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
});

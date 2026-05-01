/**
 * RL-028 sixth slice — executeTabManually snapshot gate.
 *
 * The runtime path attaches an opt-in code snapshot to the
 * execution-history record only when both gates pass:
 *   1) `executionHistorySnapshotEnabled` is `true` in `settingsStore`.
 *   2) The active tier covers `EXECUTION_HISTORY` (Pro+).
 *
 * The Pro check is a defense-in-depth gate — the toggle UI in Editor
 * settings already disables itself for Free users, but a state-shadowing
 * bug must not be able to leak captures. These tests exercise the four
 * combinations on both the success and the error branches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTrackEvent,
  mockRunnerManagerPrepare,
  mockRunnerExecute,
  mockCurrentEffectiveTier,
} = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
  mockRunnerManagerPrepare: vi.fn(),
  mockRunnerExecute: vi.fn(),
  mockCurrentEffectiveTier: vi.fn<[], 'free' | 'pro'>(() => 'free'),
}));

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
  return { useConsoleStore: { getState: () => state } };
});

vi.mock('../../src/renderer/stores/resultStore', () => {
  const state = {
    clear: vi.fn(),
    setError: vi.fn(),
    setExecutionTime: vi.fn(),
    setExecutionSource: vi.fn(),
    setFullOutput: vi.fn(),
    setIsAutoRunning: vi.fn(),
    setLineResults: vi.fn(),
    setDiagnostics: vi.fn(),
  };
  return { useResultStore: { getState: () => state } };
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

vi.mock('../../src/renderer/hooks/useEntitlement', () => ({
  currentEffectiveTier: mockCurrentEffectiveTier,
}));

import { executeTabManually } from '../../src/renderer/runtime/executeTabManually';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

const initialHistory = useExecutionHistoryStore.getState();

function setSnapshotEnabled(enabled: boolean) {
  useSettingsStore.setState({ executionHistorySnapshotEnabled: enabled });
}

const runOk = () =>
  mockRunnerManagerPrepare.mockResolvedValue({
    runner: {
      execute: mockRunnerExecute.mockResolvedValue({
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 12,
        error: undefined,
      }),
    },
    initialized: false,
  });

const runError = () =>
  mockRunnerManagerPrepare.mockResolvedValue({
    runner: {
      execute: mockRunnerExecute.mockResolvedValue({
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 5,
        error: { message: 'boom' },
      }),
    },
    initialized: false,
  });

describe('executeTabManually — snapshot gate (RL-028)', () => {
  beforeEach(() => {
    useExecutionHistoryStore.setState(initialHistory, true);
    mockTrackEvent.mockClear();
    mockRunnerManagerPrepare.mockReset();
    mockRunnerExecute.mockReset();
    mockCurrentEffectiveTier.mockReset();
  });

  afterEach(() => {
    useExecutionHistoryStore.setState(initialHistory, true);
    vi.restoreAllMocks();
  });

  it('omits snapshot when the toggle is off, even on Pro', async () => {
    setSnapshotEnabled(false);
    mockCurrentEffectiveTier.mockReturnValue('pro');
    runOk();

    await executeTabManually({
      id: 'tab-1',
      name: 'main.js',
      language: 'javascript',
      content: 'console.log("hi")',
      isDirty: false,
    });

    const [entry] = useExecutionHistoryStore.getState().entries;
    expect(entry?.snapshot).toBeNull();
  });

  it('omits snapshot when the persisted toggle is malformed, even on Pro', async () => {
    useSettingsStore.setState({
      executionHistorySnapshotEnabled: 'true' as unknown as boolean,
    });
    mockCurrentEffectiveTier.mockReturnValue('pro');
    runOk();

    await executeTabManually({
      id: 'tab-1b',
      name: 'main.js',
      language: 'javascript',
      content: 'console.log("hi")',
      isDirty: false,
    });

    const [entry] = useExecutionHistoryStore.getState().entries;
    expect(entry?.snapshot).toBeNull();
  });

  it('omits snapshot when the toggle is on but the tier is Free (defense-in-depth)', async () => {
    setSnapshotEnabled(true);
    mockCurrentEffectiveTier.mockReturnValue('free');
    runOk();

    await executeTabManually({
      id: 'tab-2',
      name: 'main.js',
      language: 'javascript',
      content: 'console.log("hi")',
      isDirty: false,
    });

    const [entry] = useExecutionHistoryStore.getState().entries;
    expect(entry?.snapshot).toBeNull();
  });

  it('captures the snapshot on success when the toggle is on and the tier is Pro', async () => {
    setSnapshotEnabled(true);
    mockCurrentEffectiveTier.mockReturnValue('pro');
    runOk();

    await executeTabManually({
      id: 'tab-3',
      name: 'main.js',
      language: 'javascript',
      content: 'console.log("hi")',
      isDirty: false,
    });

    const [entry] = useExecutionHistoryStore.getState().entries;
    expect(entry?.snapshot).toEqual({
      code: 'console.log("hi")',
      language: 'javascript',
      truncated: false,
    });
  });

  it('captures the snapshot on the error branch too — failures are replayable', async () => {
    setSnapshotEnabled(true);
    mockCurrentEffectiveTier.mockReturnValue('pro');
    runError();

    await executeTabManually({
      id: 'tab-4',
      name: 'main.py',
      language: 'python',
      content: 'print(oops)',
      isDirty: false,
    });

    const [entry] = useExecutionHistoryStore.getState().entries;
    expect(entry?.status).toBe('error');
    expect(entry?.snapshot).toEqual({
      code: 'print(oops)',
      language: 'python',
      truncated: false,
    });
  });

  it('flipping the toggle off mid-session stops new captures but does not wipe existing snapshots', async () => {
    mockCurrentEffectiveTier.mockReturnValue('pro');
    setSnapshotEnabled(true);
    runOk();
    await executeTabManually({
      id: 'tab-a',
      name: 'a.js',
      language: 'javascript',
      content: 'first',
      isDirty: false,
    });

    setSnapshotEnabled(false);
    runOk();
    await executeTabManually({
      id: 'tab-b',
      name: 'b.js',
      language: 'javascript',
      content: 'second',
      isDirty: false,
    });

    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.snapshot?.code).toBe('first');
    expect(entries[1]?.snapshot).toBeNull();
  });
});

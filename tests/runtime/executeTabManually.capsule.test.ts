/**
 * RL-094 Slice 1 — executeTabManually capsule attach.
 *
 * Asserts that the runtime pipeline:
 *
 *   - Attaches a `lastCapsule` to the execution history entry on the
 *     happy path (status: 'success').
 *   - Attaches a `lastCapsule` to the entry on the runner-error path
 *     (status: 'error').
 *   - Attaches a `lastCapsule` even on the OUTER throw path (where
 *     `runnerManager.prepareRunner` rejects before the runner runs).
 *   - Respects the `CAPSULE_LRU_CAP` cap — only the newest 5 history
 *     entries keep their `lastCapsule`; older ones get pruned on
 *     subsequent records.
 *
 * The mocks here mirror `executeTabManually.telemetry.test.ts` so a
 * capsule-specific regression surfaces without interfering with the
 * telemetry suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockTrackEvent,
  mockRunnerManagerPrepare,
  mockRunnerExecute,
  mockSetRunTermination,
  mockSetRunDeadlineAt,
  mockToExecutionPresentation,
  mockToExecutionDiagnostics,
} = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
  mockRunnerManagerPrepare: vi.fn(),
  mockRunnerExecute: vi.fn(),
  mockSetRunTermination: vi.fn(),
  mockSetRunDeadlineAt: vi.fn(),
  mockToExecutionPresentation: vi.fn(),
  mockToExecutionDiagnostics: vi.fn(),
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
    clearVisibleResults: vi.fn(),
    setError: vi.fn(),
    setExecutionTime: vi.fn(),
    setExecutionSource: vi.fn(),
    setFullOutput: vi.fn(),
    setIsAutoRunning: vi.fn(),
    setIsManualRunning: vi.fn(),
    setLineResults: vi.fn(),
    setStdinConsumed: vi.fn(),
    setDiagnostics: vi.fn(),
    setRunTermination: mockSetRunTermination,
    setRunDeadlineAt: mockSetRunDeadlineAt,
    captureSuccessfulSnapshot: vi.fn(),
    setScopeSnapshot: vi.fn(),
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
  toExecutionPresentation: mockToExecutionPresentation,
}));

vi.mock('../../src/renderer/utils/executionDiagnostics', () => ({
  toExecutionDiagnostics: mockToExecutionDiagnostics,
}));

import { executeTabManually } from '../../src/renderer/runtime/executeTabManually';
import {
  CAPSULE_LRU_CAP,
  useExecutionHistoryStore,
} from '../../src/renderer/stores/executionHistoryStore';
import { useGitStore } from '../../src/renderer/stores/gitStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

describe('executeTabManually — capsule attach (RL-094 Slice 1)', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockRunnerManagerPrepare.mockReset();
    mockRunnerExecute.mockReset();
    mockSetRunTermination.mockClear();
    mockSetRunDeadlineAt.mockClear();
    mockToExecutionPresentation.mockReset();
    mockToExecutionPresentation.mockReturnValue({
      lineResults: [],
      fullOutput: '',
    });
    mockToExecutionDiagnostics.mockReset();
    mockToExecutionDiagnostics.mockReturnValue([]);
    useExecutionHistoryStore.setState({ entries: [] });
    useGitStore.getState().clear();
    useSettingsStore.setState({ outputSourceMappingEnabled: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches lastCapsule to the history entry on a clean-success run', async () => {
    const consolePayload = { kind: 'rawText', text: 'hi' };
    const magicPayload = { kind: 'rawText', text: 'magic' };
    const diagnostics = [
      { message: 'hint', line: 1, severity: 'info', source: 'test' },
    ];
    const lineResults = [{ line: 1, value: 'hi', type: 'log' }];
    mockToExecutionPresentation.mockReturnValue({
      lineResults,
      fullOutput: '',
    });
    mockToExecutionDiagnostics.mockReturnValue(diagnostics);
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [
            { type: 'log', args: ['hi'], line: 1, payload: [consolePayload] },
          ],
          stderr: [],
          result: undefined,
          executionTime: 12,
          error: undefined,
          magicResults: [{ line: 1, value: 'magic', payload: magicPayload }],
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
      stdinBuffer: 'Ada\n42',
      inputArgs: ['--mode', 'fast'],
      inputSets: [
        {
          id: 'set-happy',
          name: 'Happy path',
          stdin: 'Ada\n42',
          args: ['--mode', 'fast'],
        },
      ],
      activeInputSetId: 'set-happy',
    });

    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.lastCapsule).toBeDefined();
    expect(entry.lastCapsule?.version).toBe(1);
    expect(entry.lastCapsule?.tab.language).toBe('javascript');
    expect(entry.lastCapsule?.source.content).toBe('console.log("hi")');
    expect(entry.lastCapsule?.result.status).toBe('success');
    expect(entry.lastCapsule?.result.stdout).toBe('hi');
    expect(entry.lastCapsule?.result.lineResults).toEqual(lineResults);
    expect(entry.lastCapsule?.result.richOutputs).toEqual([
      consolePayload,
      magicPayload,
    ]);
    expect(entry.lastCapsule?.result.diagnostics).toEqual(diagnostics);
    expect(entry.lastCapsule?.input).toEqual({
      stdin: 'Ada\n42',
      setName: 'Happy path',
      args: ['--mode', 'fast'],
    });
    expect(mockRunnerExecute).toHaveBeenCalledWith(
      'console.log("hi")',
      expect.objectContaining({
        stdin: 'Ada\n42',
        args: ['--mode', 'fast'],
      })
    );
  });

  it('attaches the run-start git snapshot to the capsule environment', async () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'abc123',
    });
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 3,
          error: undefined,
        }),
      },
      initialized: false,
    });

    await executeTabManually({
      id: 'tab-git',
      name: 'git.js',
      language: 'javascript',
      content: 'console.log("git")',
      isDirty: false,
    });

    const entry = useExecutionHistoryStore.getState().entries[0]!;
    expect(entry.lastCapsule?.environment.git).toEqual({
      branch: 'main',
      commit: 'abc123',
    });
  });

  // Slice 2 — `outputSourceMappingEnabled` was removed; origin
  // metadata is always passed through. The "OFF state strips origin"
  // case no longer applies; per-file `// @origin off` directive
  // remains the user-controlled escape hatch (covered by
  // `tests/utils/magicComments.test.ts`).

  it('attaches lastCapsule on the runner-error path', async () => {
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

    await executeTabManually({
      id: 'tab-2',
      name: 'fail.js',
      language: 'javascript',
      content: 'throw new Error("boom")',
      isDirty: false,
    });

    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.lastCapsule?.result.status).toBe('error');
    expect(entry.lastCapsule?.result.errorMessage).toBe('boom');
  });

  it('attaches lastCapsule on the outer throw path (prepareRunner rejects)', async () => {
    mockRunnerManagerPrepare.mockRejectedValue(new Error('runtime missing'));

    await executeTabManually({
      id: 'tab-3',
      name: 'broken.js',
      language: 'javascript',
      content: 'console.log(0)',
      isDirty: false,
    });

    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.status).toBe('error');
    expect(entry.lastCapsule?.result.status).toBe('error');
    expect(entry.lastCapsule?.result.errorMessage).toContain('runtime missing');
  });

  it('uses the run-start git snapshot on the outer throw path', async () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'start',
    });
    mockRunnerManagerPrepare.mockImplementation(async () => {
      useGitStore.getState().applyHeadChange({
        repoRoot: '/tmp/repo',
        branch: 'feature/later',
        commit: 'later',
        branchChanged: true,
      });
      throw new Error('runtime missing');
    });

    await executeTabManually({
      id: 'tab-throw-git',
      name: 'broken-git.js',
      language: 'javascript',
      content: 'console.log(0)',
      isDirty: false,
    });

    const entry = useExecutionHistoryStore.getState().entries[0]!;
    expect(entry.lastCapsule?.environment.git).toEqual({
      branch: 'main',
      commit: 'start',
    });
  });

  it('caps lastCapsule retention at CAPSULE_LRU_CAP entries', async () => {
    mockRunnerManagerPrepare.mockResolvedValue({
      runner: {
        execute: mockRunnerExecute.mockResolvedValue({
          stdout: [],
          stderr: [],
          result: undefined,
          executionTime: 1,
          error: undefined,
        }),
      },
      initialized: false,
    });

    // Run CAPSULE_LRU_CAP + 2 times to exceed the cap.
    for (let i = 0; i < CAPSULE_LRU_CAP + 2; i += 1) {
      await executeTabManually({
        id: `tab-${i}`,
        name: `run-${i}.js`,
        language: 'javascript',
        content: `console.log(${i})`,
        isDirty: false,
      });
    }

    const entries = useExecutionHistoryStore.getState().entries;
    expect(entries.length).toBe(CAPSULE_LRU_CAP + 2);
    const withCapsule = entries.filter((e) => e.lastCapsule !== undefined);
    expect(withCapsule.length).toBe(CAPSULE_LRU_CAP);
    // The newest CAPSULE_LRU_CAP entries (indices 2..6) keep their
    // capsule; the oldest 2 (indices 0..1) lost theirs to the LRU cap.
    expect(entries[0]!.lastCapsule).toBeUndefined();
    expect(entries[1]!.lastCapsule).toBeUndefined();
    expect(entries[entries.length - 1]!.lastCapsule).toBeDefined();
  });
});

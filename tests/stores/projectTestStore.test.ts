import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type { ProjectTestDetectionResult } from '../../src/shared/projectTests';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useNativeExecutionGateStore } from '../../src/renderer/stores/nativeExecutionGateStore';

const rootA = asRootId('root-a');
const rootB = asRootId('root-b');

function resetStore(): void {
  useProjectTestStore.setState({
    rootId: null,
    projectName: null,
    status: 'idle',
    detection: null,
    selectedFramework: null,
    result: null,
    liveOutput: { stdout: '', stderr: '' },
    error: null,
    activeRunId: null,
  });
}

function installBridge(overrides: Partial<NonNullable<LinguaAPI['projectTests']>> = {}): void {
  window.lingua = {
    ...(window.lingua ?? ({ platform: 'darwin' } as LinguaAPI)),
    projectTests: {
      detect: vi.fn().mockResolvedValue({ kind: 'none', candidates: [] }),
      run: vi.fn(),
      stop: vi.fn().mockResolvedValue({ stopped: true }),
      onOutput: vi.fn().mockReturnValue(() => undefined),
      ...overrides,
    },
  } as LinguaAPI;
}

beforeEach(() => {
  resetStore();
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  useNativeExecutionGateStore.setState({ pendingLanguage: null, pendingResume: null });
  installBridge();
});

describe('projectTestStore', () => {
  it('selects the first available detected runner', async () => {
    vi.mocked(window.lingua!.projectTests!.detect).mockResolvedValue({
      kind: 'ready',
      candidates: [
        {
          framework: 'vitest',
          command: 'vitest run --no-color',
          evidence: ['vitest.config.ts'],
          available: false,
          unavailableReason: 'dependencies-not-installed',
        },
        {
          framework: 'pytest',
          command: 'python -m pytest -q --color=no',
          evidence: ['pytest.ini'],
          available: true,
        },
      ],
    });

    await useProjectTestStore.getState().detect({ rootId: rootA, projectName: 'Alpha' });

    expect(useProjectTestStore.getState()).toMatchObject({
      rootId: rootA,
      projectName: 'Alpha',
      status: 'ready',
      selectedFramework: 'pytest',
    });
  });

  it('drops a stale detection response after the active project changes', async () => {
    let resolveFirst!: (value: ProjectTestDetectionResult) => void;
    const first = new Promise<ProjectTestDetectionResult>(resolve => {
      resolveFirst = resolve;
    });
    vi.mocked(window.lingua!.projectTests!.detect)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        kind: 'ready',
        candidates: [
          {
            framework: 'go',
            command: 'go test ./...',
            evidence: ['go.mod'],
            available: true,
          },
        ],
      });

    const stale = useProjectTestStore.getState().detect({ rootId: rootA, projectName: 'Alpha' });
    await useProjectTestStore.getState().detect({ rootId: rootB, projectName: 'Beta' });
    resolveFirst({
      kind: 'ready',
      candidates: [
        {
          framework: 'vitest',
          command: 'vitest run --no-color',
          evidence: ['vitest.config.ts'],
          available: true,
        },
      ],
    });
    await stale;

    expect(useProjectTestStore.getState()).toMatchObject({
      rootId: rootB,
      projectName: 'Beta',
      selectedFramework: 'go',
    });
  });

  it('runs the selected framework and forwards the active run id when stopping', async () => {
    let resolveRun!: (value: Awaited<ReturnType<NonNullable<LinguaAPI['projectTests']>['run']>>) => void;
    const runResult = new Promise<Awaited<ReturnType<NonNullable<LinguaAPI['projectTests']>['run']>>>(
      resolve => {
        resolveRun = resolve;
      },
    );
    const run = vi.fn().mockReturnValue(runResult);
    const stop = vi.fn().mockResolvedValue({ stopped: true });
    installBridge({ run, stop });
    useProjectTestStore.setState({
      rootId: rootA,
      projectName: 'Alpha',
      status: 'ready',
      detection: {
        kind: 'ready',
        candidates: [
          {
            framework: 'cargo',
            command: 'cargo test --color never',
            evidence: ['Cargo.toml'],
            available: true,
          },
        ],
      },
      selectedFramework: 'cargo',
    });
    const binding = { rootId: rootA, projectName: 'Alpha' };

    expect(useProjectTestStore.getState()).toMatchObject({
      rootId: rootA,
      status: 'ready',
      selectedFramework: 'cargo',
    });
    expect(window.lingua!.projectTests!.run).toBe(run);

    const pending = useProjectTestStore.getState().run(binding);
    const activeRunId = useProjectTestStore.getState().activeRunId;
    expect(activeRunId).toEqual(expect.stringMatching(/^project-tests-/u));
    await useProjectTestStore.getState().stop(binding);
    expect(stop).toHaveBeenCalledWith(rootA, activeRunId);

    resolveRun({
      kind: 'success',
      framework: 'cargo',
      command: 'cargo test --color never',
      stdout: 'test result: ok\n',
      stderr: '',
      exitCode: 0,
      executionTime: 21,
      timeoutMs: 300_000,
    });
    await pending;

    expect(run).toHaveBeenCalledWith(rootA, 'cargo', activeRunId);
    expect(useProjectTestStore.getState()).toMatchObject({
      status: 'ready',
      activeRunId: null,
      result: { kind: 'success', framework: 'cargo' },
    });
  });

  it('stops an active run before binding detection to a different project', async () => {
    const stop = vi.fn().mockResolvedValue({ stopped: true });
    installBridge({ stop });
    useProjectTestStore.setState({
      rootId: rootA,
      projectName: 'Alpha',
      status: 'running',
      activeRunId: 'project-tests-active',
    });

    await useProjectTestStore.getState().detect({ rootId: rootB, projectName: 'Beta' });

    expect(stop).toHaveBeenCalledWith(rootA, 'project-tests-active');
    expect(useProjectTestStore.getState()).toMatchObject({
      rootId: rootB,
      projectName: 'Beta',
      status: 'ready',
      activeRunId: null,
    });
  });

  it('drops an acknowledged run request if the project changed behind the warning', () => {
    const run = vi.fn();
    installBridge({ run });
    useSettingsStore.setState({ nativeExecutionAcknowledged: false });
    useProjectTestStore.setState({
      rootId: rootA,
      projectName: 'Alpha',
      status: 'ready',
      detection: {
        kind: 'ready',
        candidates: [
          {
            framework: 'vitest',
            command: 'vitest run --no-color',
            evidence: ['vitest.config.ts'],
            available: true,
          },
        ],
      },
      selectedFramework: 'vitest',
    });

    void useProjectTestStore.getState().run({ rootId: rootA, projectName: 'Alpha' });
    useProjectTestStore.setState({ rootId: rootB, projectName: 'Beta' });
    useSettingsStore.setState({ nativeExecutionAcknowledged: true });
    useNativeExecutionGateStore.getState().confirm();

    expect(run).not.toHaveBeenCalled();
  });
});

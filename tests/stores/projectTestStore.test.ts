import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGoTestCollector, parseJestStyleReport } from '../../src/main/projectTestReports';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type { ProjectTestDetectionResult } from '../../src/shared/projectTests';
import { mergeProjectTestCases, useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
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
  it('keeps live chunks in observed order and ignores foreign or settled run messages', async () => {
    let emit!: (event: import('../../src/shared/projectTests').ProjectTestOutputEvent) => void;
    let finish!: (result: import('../../src/shared/projectTests').ProjectTestRunResult) => void;
    const unsubscribe = vi.fn();
    installBridge({
      onOutput: handler => {
        emit = handler;
        return unsubscribe;
      },
      run: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    });
    useProjectTestStore.setState({ rootId: rootA, status: 'ready', selectedFramework: 'vitest' });
    const pending = useProjectTestStore.getState().run({ rootId: rootA, projectName: 'Alpha' });
    const runId = useProjectTestStore.getState().activeRunId!;
    emit({ runId, stream: 'stdout', chunk: 'first\n' });
    emit({ runId: 'foreign', stream: 'stderr', chunk: 'IGNORE' });
    emit({ runId, stream: 'stderr', chunk: 'warning\n' });
    emit({ runId, stream: 'stdout', chunk: 'last\n' });
    expect(useProjectTestStore.getState().liveOutput.transcript?.text).toBe(
      'first\nwarning\nlast\n'
    );
    finish({
      kind: 'success',
      framework: 'vitest',
      command: 'vitest',
      stdout: 'first\nlast\n',
      stderr: 'warning\n',
      orderedOutput: 'first\nwarning\nlast\n',
      exitCode: 0,
      executionTime: 3,
      timeoutMs: 300000,
    });
    await pending;
    emit({ runId, stream: 'stderr', chunk: 'LATE' });
    expect(useProjectTestStore.getState().liveOutput.transcript?.text).toBe(
      'first\nwarning\nlast\n'
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
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
    let resolveRun!: (
      value: Awaited<ReturnType<NonNullable<LinguaAPI['projectTests']>['run']>>
    ) => void;
    const runResult = new Promise<
      Awaited<ReturnType<NonNullable<LinguaAPI['projectTests']>['run']>>
    >(resolve => {
      resolveRun = resolve;
    });
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

    expect(run).toHaveBeenCalledWith(rootA, 'cargo', activeRunId, { kind: 'all' });
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

describe('mergeProjectTestCases', () => {
  const tc = (file: string, name: string, status: 'passed' | 'failed' | 'skipped' = 'passed') => ({ file, path: [name], status });
  const list = [tc('a.test.ts', 'one'), tc('a.test.ts', 'two', 'failed'), tc('b.test.ts', 'three')];

  it('retains a parsed Go build failure on an individual rerun without importing unrelated passes', () => {
    const collector = createGoTestCollector('example.com/shop');
    collector.push(readFileSync('tests/__fixtures__/projectTests/go-build-fail.ndjson', 'utf8'));
    collector.flush();
    const incoming = collector.finish().cases;
    const previous = [tc('internal/broken', 'TestX'), tc('internal/other', 'TestOther')];
    const merged = mergeProjectTestCases(previous, { kind: 'test', file: 'internal/broken', path: ['TestX'] }, incoming);
    expect(merged).toEqual([
      { ...previous[0], stale: true }, { ...previous[1], stale: true },
      expect.objectContaining({ file: 'internal/broken', path: [], status: 'failed', runnable: false, failureLine: 5 }),
    ]);
    expect(merged.some(entry => entry.path.includes('TestRoot'))).toBe(false);
  });

  it('treats a Jest file failure the same way and clears it after a successful rerun', () => {
    const parsed = parseJestStyleReport(JSON.stringify({ testResults: [{
      name: path.resolve('a.test.ts'), status: 'failed', assertionResults: [], message: 'SyntaxError: unexpected token',
    }] }), process.cwd())!;
    const scope = { kind: 'test' as const, file: 'a.test.ts', path: ['one'] };
    const blocked = mergeProjectTestCases(list, scope, parsed.cases);
    expect(blocked).toContainEqual(expect.objectContaining({ file: 'a.test.ts', path: [], status: 'failed', runnable: false }));
    expect(blocked[0]).toMatchObject({ stale: true });
    const recovered = mergeProjectTestCases(blocked, scope, [tc('a.test.ts', 'one')]);
    expect(recovered.filter(entry => entry.file === 'a.test.ts' && entry.path.length === 0)).toEqual([]);
    expect(recovered.find(entry => entry.path[0] === 'one')).toEqual(tc('a.test.ts', 'one'));
  });

  it('replaces only the tests of a file run, in place', () => {
    const merged = mergeProjectTestCases(list, { kind: 'file', file: 'a.test.ts' }, [tc('a.test.ts', 'one'), tc('a.test.ts', 'two'), tc('z.test.ts', 'other')]);
    expect(merged.map((entry) => `${entry.file}:${entry.path[0]}:${entry.status}`)).toEqual([
      'a.test.ts:one:passed',
      'a.test.ts:two:passed',
      'b.test.ts:three:passed',
    ]);
  });

  it('updates one test and ignores the siblings a name filter reports as skipped', () => {
    const merged = mergeProjectTestCases(list, { kind: 'test', file: 'a.test.ts', path: ['two'] }, [tc('a.test.ts', 'one', 'skipped'), tc('a.test.ts', 'two')]);
    expect(merged.map((entry) => entry.status)).toEqual(['passed', 'passed', 'passed']);
  });

  it('takes the whole list from a full run, and from a first scoped run', () => {
    expect(mergeProjectTestCases(list, { kind: 'all' }, [tc('c.test.ts', 'x')])).toEqual([tc('c.test.ts', 'x')]);
    expect(mergeProjectTestCases(null, { kind: 'file', file: 'a.test.ts' }, [tc('a.test.ts', 'one')])).toEqual([tc('a.test.ts', 'one')]);
  });
});

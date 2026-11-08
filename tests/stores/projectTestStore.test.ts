import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGoTestCollector, parseJestStyleReport } from '../../src/main/projectTestReports';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type {
  ProjectTestDetectionResult,
  ProjectTestOutputEvent,
  ProjectTestRunResult,
} from '../../src/shared/projectTests';
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

describe('projectTestStore run ownership across project switches', () => {
  const alpha = { rootId: rootA, projectName: 'Alpha' };
  const beta = { rootId: rootB, projectName: 'Beta' };
  const store = () => useProjectTestStore.getState();
  const vitestReady: ProjectTestDetectionResult = {
    kind: 'ready',
    candidates: [
      { framework: 'vitest', command: 'vitest run', evidence: ['vitest.config.ts'], available: true },
    ],
  };
  // What main sends back for a stopped run: no cases.
  const stopped: ProjectTestRunResult = {
    kind: 'stopped',
    framework: 'vitest',
    command: '',
    stdout: '',
    stderr: '',
    exitCode: -1,
    executionTime: 0,
    timeoutMs: 300_000,
  };

  function deferredRun() {
    let resolve!: (result: ProjectTestRunResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ProjectTestRunResult>((resolveRun, rejectRun) => {
      resolve = resolveRun;
      reject = rejectRun;
    });
    return { promise, resolve, reject };
  }

  function passed(file: string): ProjectTestRunResult {
    return {
      kind: 'success',
      framework: 'vitest',
      command: 'vitest run',
      stdout: `${file} passed\n`,
      stderr: '',
      exitCode: 0,
      executionTime: 3,
      timeoutMs: 300_000,
      cases: [{ file, path: ['passes'], status: 'passed' }],
    };
  }

  function ownershipBridge(
    run: NonNullable<LinguaAPI['projectTests']>['run'],
    stop: NonNullable<LinguaAPI['projectTests']>['stop'] = vi.fn().mockResolvedValue({ stopped: true })
  ) {
    const listeners: ((event: ProjectTestOutputEvent) => void)[] = [];
    const unsubscribers: ReturnType<typeof vi.fn>[] = [];
    installBridge({
      detect: vi.fn().mockResolvedValue(vitestReady),
      run,
      stop,
      onOutput: handler => {
        listeners.push(handler);
        const unsubscribe = vi.fn();
        unsubscribers.push(unsubscribe);
        return unsubscribe;
      },
    });
    const unsubscribeCalls = () => unsubscribers.map(unsubscribe => unsubscribe.mock.calls.length);
    return { listeners, unsubscribeCalls };
  }

  it.each(['resolves', 'rejects'] as const)(
    'keeps the new project run when the old one %s late',
    async settlement => {
      const oldRun = deferredRun();
      const currentRun = deferredRun();
      const run = vi.fn().mockReturnValueOnce(oldRun.promise).mockReturnValueOnce(currentRun.promise);
      const stop = vi.fn().mockResolvedValue({ stopped: true });
      const { listeners, unsubscribeCalls } = ownershipBridge(run, stop);

      await store().detect(alpha);
      const oldPending = store().run(alpha);
      const oldId = store().activeRunId!;
      listeners[0]!({ runId: oldId, stream: 'stdout', chunk: 'alpha running\n' });

      await store().detect(beta);
      const currentPending = store().run(beta);
      const currentId = store().activeRunId!;
      expect(currentId).not.toBe(oldId);
      expect(run).toHaveBeenLastCalledWith(beta.rootId, 'vitest', currentId, { kind: 'all' });
      listeners[1]!({ runId: currentId, stream: 'stdout', chunk: 'beta running\n' });
      const currentState = store();

      listeners[0]!({ runId: oldId, stream: 'stderr', chunk: 'late alpha output\n' });
      if (settlement === 'resolves') oldRun.resolve(passed('alpha.test.ts'));
      else oldRun.reject(new Error('Alpha stopped after switching projects'));
      await oldPending;

      // Not one write, so no equal-looking overwrite either.
      expect(store()).toBe(currentState);
      expect(store()).toMatchObject({
        rootId: beta.rootId,
        projectName: 'Beta',
        status: 'running',
        activeRunId: currentId,
        result: null,
        cases: null,
        liveOutput: { stdout: 'beta running\n', stderr: '' },
      });
      expect(unsubscribeCalls()).toEqual([1, 0]);

      await store().stop(beta);
      expect(stop).toHaveBeenLastCalledWith(beta.rootId, currentId);
      currentRun.resolve(stopped);
      await currentPending;
      expect(store()).toMatchObject({
        rootId: beta.rootId,
        status: 'ready',
        activeRunId: null,
        runningScope: null,
        result: stopped,
        cases: null,
        error: null,
      });

      const settledState = store();
      listeners[0]!({ runId: oldId, stream: 'stdout', chunk: 'alpha after cleanup\n' });
      listeners[1]!({ runId: currentId, stream: 'stdout', chunk: 'beta after cleanup\n' });
      expect(store()).toBe(settledState);
      expect(unsubscribeCalls()).toEqual([1, 1]);
    }
  );

  it('keeps an old run that settles while the switch is still stopping it out of the new project', async () => {
    const oldRun = deferredRun();
    let oldPending!: Promise<void>;
    // Stopping kills the process, so the old run usually settles before the stop reply.
    const stop = vi.fn(async () => {
      oldRun.resolve(stopped);
      await oldPending;
      return { stopped: true };
    });
    const { unsubscribeCalls } = ownershipBridge(vi.fn().mockReturnValueOnce(oldRun.promise), stop);

    await store().detect(alpha);
    oldPending = store().run(alpha);
    await store().detect(beta);

    expect(stop).toHaveBeenCalledOnce();
    expect(store()).toMatchObject({
      rootId: beta.rootId,
      projectName: 'Beta',
      status: 'ready',
      selectedFramework: 'vitest',
      activeRunId: null,
      result: null,
      cases: null,
      liveOutput: { stdout: '', stderr: '' },
    });
    expect(unsubscribeCalls()).toEqual([1]);
  });
});

describe('projectTestStore focused failure', () => {
  const test = { file: 'cart/total.test.ts', path: ['cartTotal', 'rounds cents'] };
  const runResult = (status: 'passed' | 'failed') => ({
    kind: status === 'passed' ? ('success' as const) : ('failed' as const),
    framework: 'vitest' as const,
    command: 'vitest run',
    stdout: '',
    stderr: '',
    exitCode: status === 'passed' ? 0 : 1,
    executionTime: 1,
    timeoutMs: 300_000,
    cases: [{ ...test, status }],
  });

  it('keeps the card while the test still fails and closes it once it passes', async () => {
    const run = vi.fn().mockResolvedValueOnce(runResult('failed')).mockResolvedValueOnce(runResult('passed'));
    installBridge({ run });
    useProjectTestStore.setState({ rootId: rootA, projectName: 'a', status: 'ready', selectedFramework: 'vitest', cases: null, focusedFailure: test });
    await useProjectTestStore.getState().run({ rootId: rootA, projectName: 'a' }, { kind: 'test', ...test });
    expect(useProjectTestStore.getState().focusedFailure).toEqual(test);
    await useProjectTestStore.getState().run({ rootId: rootA, projectName: 'a' }, { kind: 'test', ...test });
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();
  });

  it('forgets the card when the project or runner changes', async () => {
    useProjectTestStore.setState({ focusedFailure: test });
    useProjectTestStore.getState().selectFramework('jest');
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();
    useProjectTestStore.setState({ focusedFailure: test });
    await useProjectTestStore.getState().detect({ rootId: rootB, projectName: 'b' });
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();
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
      { ...previous[0], stale: true }, previous[1],
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

  it('clears a dependency build failure once the run that reported it passes', () => {
    const collector = createGoTestCollector('example.com/shop');
    collector.push([
      { ImportPath: 'example.com/shop/internal/dep [example.com/shop/internal/broken.test]', Action: 'build-output', Output: 'internal/dep/dep.go:3:1: syntax error\n' },
      { ImportPath: 'example.com/shop/internal/dep [example.com/shop/internal/broken.test]', Action: 'build-fail' },
      { Action: 'fail', Package: 'example.com/shop/internal/broken', FailedBuild: 'example.com/shop/internal/broken.test' },
    ].map(event => `${JSON.stringify(event)}\n`).join(''));
    collector.flush();
    const previous = [tc('internal/broken', 'TestX'), tc('internal/other', 'TestOther')];
    const scope = { kind: 'test' as const, file: 'internal/broken', path: ['TestX'] };
    const blocked = mergeProjectTestCases(previous, scope, collector.finish().cases);
    expect(blocked).toContainEqual(expect.objectContaining({ file: 'internal/dep', path: [], runnable: false, failureLine: 3 }));

    expect(mergeProjectTestCases(blocked, scope, [tc('internal/broken', 'TestX')])).toEqual(previous);
    expect(mergeProjectTestCases(blocked, { kind: 'file', file: 'internal/broken' }, [tc('internal/broken', 'TestX')])).toEqual(previous);
    expect(mergeProjectTestCases(blocked, { kind: 'file', file: 'internal/other' }, [tc('internal/other', 'TestOther')]))
      .toContainEqual(expect.objectContaining({ file: 'internal/dep', path: [] }));
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

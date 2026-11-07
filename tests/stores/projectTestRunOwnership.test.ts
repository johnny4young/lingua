import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type { ProjectTestOutputEvent, ProjectTestRunResult } from '../../src/shared/projectTests';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

function deferredRun() {
  let resolve!: (result: ProjectTestRunResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProjectTestRunResult>((resolveRun, rejectRun) => {
    resolve = resolveRun;
    reject = rejectRun;
  });
  return { promise, resolve, reject };
}

function result(file: string): ProjectTestRunResult {
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

beforeEach(() => {
  useProjectTestStore.setState(useProjectTestStore.getInitialState(), true);
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
});

describe('project-test run ownership across project switches', () => {
  it.each(['resolves', 'rejects'] as const)(
    'keeps the new run active when the old project run %s late',
    async settlement => {
      const oldRun = deferredRun();
      const currentRun = deferredRun();
      const listeners: ((event: ProjectTestOutputEvent) => void)[] = [];
      const unsubscribers = [vi.fn(), vi.fn()];
      const run = vi
        .fn()
        .mockReturnValueOnce(oldRun.promise)
        .mockReturnValueOnce(currentRun.promise);
      const stop = vi.fn().mockResolvedValue({ stopped: true });
      window.lingua = {
        ...(window.lingua ?? ({ platform: 'darwin' } as LinguaAPI)),
        projectTests: {
          detect: vi.fn().mockResolvedValue({
            kind: 'ready',
            candidates: [
              {
                framework: 'vitest',
                command: 'vitest run',
                evidence: ['vitest.config.ts'],
                available: true,
              },
            ],
          }),
          run,
          stop,
          onOutput: handler => {
            const unsubscribe = unsubscribers[listeners.length];
            listeners.push(handler);
            return unsubscribe;
          },
        },
      } as LinguaAPI;
      const alpha = { rootId: asRootId('root-alpha'), projectName: 'Alpha' };
      const beta = { rootId: asRootId('root-beta'), projectName: 'Beta' };
      const store = () => useProjectTestStore.getState();

      await store().detect(alpha);
      const oldPending = store().run(alpha);
      const oldId = store().activeRunId!;
      listeners[0]({ runId: oldId, stream: 'stdout', chunk: 'alpha running\n' });

      await store().detect(beta);
      expect(stop).toHaveBeenCalledWith(alpha.rootId, oldId);
      const currentPending = store().run(beta);
      const currentId = store().activeRunId!;
      expect(currentId).not.toBe(oldId);
      listeners[1]({ runId: currentId, stream: 'stdout', chunk: 'beta running\n' });
      const currentState = store();

      // Even an already queued callback from the old subscription is inert.
      listeners[0]({ runId: oldId, stream: 'stderr', chunk: 'late alpha output\n' });
      expect(store()).toEqual(currentState);
      if (settlement === 'resolves') oldRun.resolve(result('alpha.test.ts'));
      else oldRun.reject(new Error('Alpha stopped after switching projects'));
      await oldPending;

      expect(store()).toEqual(currentState);
      expect(store()).toMatchObject({
        rootId: beta.rootId,
        projectName: 'Beta',
        status: 'running',
        activeRunId: currentId,
        runningScope: { kind: 'all' },
        result: null,
        cases: null,
        error: null,
        liveOutput: { stdout: 'beta running\n', stderr: '' },
      });
      expect(unsubscribers[0]).toHaveBeenCalledOnce();
      expect(unsubscribers[1]).not.toHaveBeenCalled();
      await store().stop(beta);
      expect(stop).toHaveBeenLastCalledWith(beta.rootId, currentId);

      const betaResult = result('beta.test.ts');
      currentRun.resolve(betaResult);
      await currentPending;
      expect(store()).toMatchObject({
        rootId: beta.rootId,
        status: 'ready',
        activeRunId: null,
        runningScope: null,
        result: betaResult,
        cases: betaResult.cases,
        error: null,
      });
      const settledState = store();
      listeners[0]({ runId: oldId, stream: 'stdout', chunk: 'alpha after cleanup\n' });
      listeners[1]({ runId: currentId, stream: 'stdout', chunk: 'beta after cleanup\n' });
      expect(store()).toEqual(settledState);
      expect(unsubscribers[1]).toHaveBeenCalledOnce();
    }
  );
});

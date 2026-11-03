import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeDiffOffThread,
  runPipelineOffThread,
} from '../../src/renderer/runtime/utilityComputeClient';
import type { UtilityComputeRequest } from '../../src/renderer/runtime/utilityComputeProtocol';
import type { UtilityPipelineV1 } from '../../src/shared/utilityPipeline';

class FakeWorker extends EventEmitter {
  posted: UtilityComputeRequest | null = null;
  terminate = vi.fn();

  addEventListener(type: string, listener: (...args: never[]) => void) {
    this.on(type, listener);
  }

  postMessage(request: UtilityComputeRequest) {
    this.posted = request;
  }
}

describe('utility compute worker client', () => {
  describe('a worker that stops answering', () => {
    const pipeline = {
      schemaVersion: 1,
      id: 'p',
      name: 'p',
      createdAt: '',
      updatedAt: '',
      steps: ['a', 'b', 'c'].map((id) => ({ id, utilityId: 'regex-replace', options: {} })),
    } as unknown as UtilityPipelineV1;
    const ok = { stepId: 'a', utilityId: 'regex-replace', status: 'ok', output: 'x', durationMs: 1 };

    afterEach(() => vi.useRealTimers());

    it('times out the stuck step past its deadline, re-armed on each reported step', async () => {
      vi.useFakeTimers();
      const worker = new FakeWorker();
      const onStepSettled = vi.fn();
      const promise = runPipelineOffThread({ pipeline, input: 'i', stepTimeoutMs: 100, onStepSettled, workerFactory: () => worker as unknown as Worker });
      await vi.advanceTimersByTimeAsync(1000);
      worker.emit('message', { data: { type: 'pipeline-step', requestId: worker.posted?.requestId, result: ok } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(worker.terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      const outcome = await promise;
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(outcome?.status).toBe('partial');
      expect(outcome?.results.map((result) => result.status)).toEqual(['ok', 'timeout', 'skipped']);
      expect(onStepSettled.mock.calls.map(([result]) => result.status)).toEqual(['ok', 'timeout', 'skipped']);
    });

    it('leaves no deadline behind once the run settles', async () => {
      vi.useFakeTimers();
      const worker = new FakeWorker();
      const promise = runPipelineOffThread({ pipeline, input: 'i', stepTimeoutMs: 100, workerFactory: () => worker as unknown as Worker });
      const outcome = { status: 'all-ok', results: [], durationMs: 1 };
      worker.emit('message', { data: { type: 'pipeline-result', requestId: worker.posted?.requestId, outcome } });
      await expect(promise).resolves.toBe(outcome);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops on abort, without reporting steps that never settled', async () => {
      const worker = new FakeWorker();
      const controller = new AbortController();
      const onStepSettled = vi.fn();
      const promise = runPipelineOffThread({ pipeline, input: 'i', onStepSettled, signal: controller.signal, workerFactory: () => worker as unknown as Worker });
      controller.abort();
      await expect(promise).resolves.toMatchObject({ results: [{ status: 'timeout' }, { status: 'skipped' }, { status: 'skipped' }] });
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(onStepSettled).not.toHaveBeenCalled();
    });
  });

  it('routes heavy diff payloads through the worker protocol', async () => {
    const worker = new FakeWorker();
    const promise = computeDiffOffThread(
      'before',
      'after',
      'line',
      () => worker as unknown as Worker
    );
    expect(worker.posted?.type).toBe('diff');
    const id = worker.posted?.requestId ?? '';
    worker.emit('message', {
      data: {
        type: 'diff-result',
        requestId: id,
        segments: [{ kind: 'add', text: 'after' }],
      },
    });
    await expect(promise).resolves.toEqual([{ kind: 'add', text: 'after' }]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('settles a diff request only once when worker events race', async () => {
    const worker = new FakeWorker();
    const promise = computeDiffOffThread(
      'before',
      'after',
      'line',
      () => worker as unknown as Worker
    );
    const id = worker.posted?.requestId ?? '';
    worker.emit('message', {
      data: {
        type: 'diff-result',
        requestId: id,
        segments: [{ kind: 'add', text: 'after' }],
      },
    });
    worker.emit('error', new Error('late worker error'));

    await expect(promise).resolves.toEqual([{ kind: 'add', text: 'after' }]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a superseded diff worker when its signal aborts', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = computeDiffOffThread(
      'before',
      'after',
      'line',
      () => worker as unknown as Worker,
      controller.signal
    );
    controller.abort();
    await expect(promise).resolves.toEqual([]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('never starts a worker for an already-aborted diff', async () => {
    const factory = vi.fn(() => new FakeWorker() as unknown as Worker);
    const controller = new AbortController();
    controller.abort();
    await expect(
      computeDiffOffThread('before', 'after', 'line', factory, controller.signal)
    ).resolves.toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('streams pipeline steps before resolving the aggregate outcome', async () => {
    const worker = new FakeWorker();
    const onStepSettled = vi.fn();
    const promise = runPipelineOffThread({
      pipeline: {
        version: 1,
        id: 'pipeline-1',
        name: 'Test',
        steps: [],
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
      input: 'value',
      onStepSettled,
      workerFactory: () => worker as unknown as Worker,
    });
    const id = worker.posted?.requestId ?? '';
    const step = {
      stepId: 'step-1',
      utilityId: 'json-format' as const,
      status: 'ok' as const,
      output: '{}',
      durationMs: 2,
    };
    worker.emit('message', {
      data: { type: 'pipeline-step', requestId: id, result: step },
    });
    expect(onStepSettled).toHaveBeenCalledWith(step);
    const outcome = { status: 'all-ok' as const, results: [step], durationMs: 3 };
    worker.emit('message', {
      data: { type: 'pipeline-result', requestId: id, outcome },
    });
    await expect(promise).resolves.toEqual(outcome);
  });
});

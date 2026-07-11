import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  computeDiffOffThread,
  runPipelineOffThread,
} from '../../src/renderer/runtime/utilityComputeClient';
import type { UtilityComputeRequest } from '../../src/renderer/runtime/utilityComputeProtocol';

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

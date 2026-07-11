/**
 * Locks the runner's settle contract: a worker failure (crash or
 * protocol error) must fall back to the inline `runPipeline` path and
 * resolve with a real aggregate outcome — never reject — and steps the
 * worker already streamed must not be re-emitted by the fallback.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runUtilityPipeline } from '../../../src/renderer/runtime/utilityPipelineRunner';
import type { UtilityComputeRequest } from '../../../src/renderer/runtime/utilityComputeProtocol';
import type { UtilityPipelineV1 } from '../../../src/shared/utilityPipeline';

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

function decodePipeline(): UtilityPipelineV1 {
  return {
    version: 1,
    id: 'pipe-runner-1',
    name: 'decode',
    steps: [{ id: 'step-1', utilityId: 'base64-decode', options: {} }],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}

describe('runUtilityPipeline', () => {
  it('falls back inline and still settles when the worker crashes before any step', async () => {
    const worker = new FakeWorker();
    const onStepSettled = vi.fn();
    const promise = runUtilityPipeline({
      pipeline: decodePipeline(),
      input: 'aGVsbG8=',
      onStepSettled,
      workerFactory: () => worker as unknown as Worker,
    });
    worker.emit('error', new Error('worker exploded'));

    const outcome = await promise;
    expect(outcome.status).toBe('all-ok');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({
      stepId: 'step-1',
      status: 'ok',
      output: 'hello',
    });
    // The inline fallback emitted the step exactly once.
    expect(onStepSettled).toHaveBeenCalledTimes(1);
    expect(onStepSettled.mock.calls[0]?.[0]).toMatchObject({ stepId: 'step-1' });
  });

  it('does not re-emit steps the worker already streamed before a protocol error', async () => {
    const worker = new FakeWorker();
    const onStepSettled = vi.fn();
    const promise = runUtilityPipeline({
      pipeline: decodePipeline(),
      input: 'aGVsbG8=',
      onStepSettled,
      workerFactory: () => worker as unknown as Worker,
    });
    const id = worker.posted?.requestId ?? '';
    worker.emit('message', {
      data: {
        type: 'pipeline-step',
        requestId: id,
        result: {
          stepId: 'step-1',
          utilityId: 'base64-decode',
          status: 'ok',
          output: 'hello',
          durationMs: 1,
        },
      },
    });
    worker.emit('message', {
      data: { type: 'error', requestId: id, message: 'worker gave up mid-run' },
    });

    const outcome = await promise;
    expect(outcome.status).toBe('all-ok');
    expect(outcome.results).toHaveLength(1);
    // One emission from the worker stream, none duplicated by the fallback.
    expect(onStepSettled).toHaveBeenCalledTimes(1);
  });
});

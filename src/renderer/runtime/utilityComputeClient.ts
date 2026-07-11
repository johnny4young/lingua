import type {
  PipelineRunOutcome,
  PipelineStepResult,
  UtilityPipelineV1,
} from '../../shared/utilityPipeline';
import { computeDiff } from '../utils/diff';
import type { DiffGranularity, DiffSegment } from '../utils/diff';
import type {
  UtilityComputeRequest,
  UtilityComputeResponse,
} from './utilityComputeProtocol';

export type UtilityComputeWorkerFactory = () => Worker | null;

function defaultWorkerFactory(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(
    new URL('../workers/utility-compute-worker.ts', import.meta.url),
    { type: 'module' }
  );
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function computeDiffOffThread(
  left: string,
  right: string,
  granularity: DiffGranularity,
  workerFactory: UtilityComputeWorkerFactory = defaultWorkerFactory
): Promise<DiffSegment[]> {
  let worker: Worker | null = null;
  try {
    worker = workerFactory();
  } catch {
    return computeDiff(left, right, granularity);
  }
  if (!worker) return computeDiff(left, right, granularity);

  const id = requestId('diff');
  return await new Promise<DiffSegment[]>((resolve) => {
    let settled = false;
    const finish = (segments: DiffSegment[]) => {
      if (settled) return;
      settled = true;
      worker?.terminate();
      resolve(segments);
    };
    worker.addEventListener('message', (event: MessageEvent<UtilityComputeResponse>) => {
      const response = event.data;
      if (response.requestId !== id) return;
      if (response.type === 'diff-result') {
        finish(response.segments);
      } else if (response.type === 'error') {
        finish(computeDiff(left, right, granularity));
      }
    });
    worker.addEventListener('error', () => {
      finish(computeDiff(left, right, granularity));
    });
    const request: UtilityComputeRequest = {
      type: 'diff',
      requestId: id,
      left,
      right,
      granularity,
    };
    worker.postMessage(request);
  });
}

export interface RunPipelineOffThreadOptions {
  readonly pipeline: UtilityPipelineV1;
  readonly input: string;
  readonly onStepSettled?: (result: PipelineStepResult) => void;
  readonly stepTimeoutMs?: number;
  readonly workerFactory?: UtilityComputeWorkerFactory;
}

export async function runPipelineOffThread(
  options: RunPipelineOffThreadOptions
): Promise<PipelineRunOutcome | null> {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  let worker: Worker | null;
  try {
    worker = workerFactory();
  } catch {
    return null;
  }
  if (!worker) return null;

  const id = requestId('pipeline');
  return await new Promise<PipelineRunOutcome>((resolve, reject) => {
    let settled = false;
    const cleanup = () => worker?.terminate();
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    worker.addEventListener('message', (event: MessageEvent<UtilityComputeResponse>) => {
      const response = event.data;
      if (response.requestId !== id) return;
      if (response.type === 'pipeline-step') {
        options.onStepSettled?.(response.result);
        return;
      }
      if (response.type === 'pipeline-result') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response.outcome);
        return;
      }
      if (response.type === 'error') fail(response.message);
    });
    worker.addEventListener('error', () => fail('Utility compute worker failed'));
    const request: UtilityComputeRequest = {
      type: 'pipeline',
      requestId: id,
      pipeline: options.pipeline,
      input: options.input,
      ...(options.stepTimeoutMs === undefined
        ? {}
        : { stepTimeoutMs: options.stepTimeoutMs }),
    };
    worker.postMessage(request);
  });
}

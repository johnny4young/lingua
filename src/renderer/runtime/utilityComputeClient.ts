import {
  outcomeOfStalledRun,
  STEP_TIMEOUT_MS,
  type PipelineRunOutcome,
  type PipelineStepResult,
  type UtilityPipelineV1,
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

/** Aborting `signal` terminates the worker and resolves with no segments. */
export async function computeDiffOffThread(
  left: string,
  right: string,
  granularity: DiffGranularity,
  workerFactory: UtilityComputeWorkerFactory = defaultWorkerFactory,
  signal?: AbortSignal
): Promise<DiffSegment[]> {
  if (signal?.aborted) return [];
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
    const onAbort = () => finish([]);
    const finish = (segments: DiffSegment[]) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker?.terminate();
      resolve(segments);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
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

/** Past the worker's own step timeout, so a step that can still time out reports it first. */
const STALL_GRACE_MS = 1_000;

export interface RunPipelineOffThreadOptions {
  readonly pipeline: UtilityPipelineV1;
  readonly input: string;
  readonly onStepSettled?: (result: PipelineStepResult) => void;
  readonly stepTimeoutMs?: number;
  readonly workerFactory?: UtilityComputeWorkerFactory;
  /** Aborting terminates the worker and settles with what it had reported. */
  readonly signal?: AbortSignal;
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
    const reported: PipelineStepResult[] = [];
    const stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    const startedAt = Date.now();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(stallTimer);
      options.signal?.removeEventListener('abort', onAbort);
      worker?.terminate();
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    // Settles rather than failing: the inline fallback would hang the renderer on the same step.
    const stopEarly = (notify: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      const outcome = outcomeOfStalledRun(options.pipeline, reported, stepTimeoutMs, Date.now() - startedAt);
      if (notify) outcome.results.slice(reported.length).forEach((result) => options.onStepSettled?.(result));
      resolve(outcome);
    };
    const onAbort = () => stopEarly(false);
    const watchForStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => stopEarly(true), stepTimeoutMs + STALL_GRACE_MS);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<UtilityComputeResponse>) => {
      const response = event.data;
      if (response.requestId !== id) return;
      if (response.type === 'pipeline-step') {
        if (settled) return;
        reported.push(response.result);
        watchForStall();
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
    watchForStall();
    worker.postMessage(request);
    if (options.signal?.aborted) stopEarly(false);
  });
}

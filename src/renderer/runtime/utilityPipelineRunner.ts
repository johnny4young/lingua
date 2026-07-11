/**
 * RL-099 Slice 1 — renderer-side pipeline runner.
 *
 * Thin wrapper around `runPipeline` (in `src/shared/utilityPipeline.ts`)
 * that surfaces per-step results as a React-friendly array via the
 * `onStepSettled` callback. The hook layer
 * (`src/renderer/hooks/useUtilityPipelineRun.ts`) wraps this into a
 * `{idle | running | settled}` state machine.
 *
 * The runner is its own module (not just inlined in the hook) so
 * future RL-098 CLI Companion can reuse it for `lingua pipeline run`
 * without dragging React in.
 */

import {
  runPipeline,
  type PipelineRunOutcome,
  type PipelineStepResult,
  type RunPipelineOptions,
  type UtilityPipelineV1,
} from '../../shared/utilityPipeline';
import {
  runPipelineOffThread,
  type UtilityComputeWorkerFactory,
} from './utilityComputeClient';

export interface PipelineRunnerOptions {
  pipeline: UtilityPipelineV1;
  input: string;
  onStepSettled?: (result: PipelineStepResult) => void;
  /** Test seam — override the per-step timeout. */
  stepTimeoutMs?: number;
  /** Test seam; production creates the dedicated utility compute worker. */
  workerFactory?: UtilityComputeWorkerFactory;
}

/**
 * Execute a pipeline. Settles with the aggregate outcome + the full
 * step results array. Streaming callers should also subscribe via
 * `options.onStepSettled` to see partial results before the whole
 * pipeline completes.
 */
export async function runUtilityPipeline(
  options: PipelineRunnerOptions
): Promise<PipelineRunOutcome> {
  const workerOutcome = await runPipelineOffThread({
    pipeline: options.pipeline,
    input: options.input,
    ...(options.onStepSettled
      ? { onStepSettled: options.onStepSettled }
      : {}),
    ...(options.stepTimeoutMs === undefined
      ? {}
      : { stepTimeoutMs: options.stepTimeoutMs }),
    ...(options.workerFactory ? { workerFactory: options.workerFactory } : {}),
  });
  if (workerOutcome) return workerOutcome;

  const runOptions: RunPipelineOptions = {};
  if (options.onStepSettled) runOptions.onStepSettled = options.onStepSettled;
  if (options.stepTimeoutMs !== undefined) {
    runOptions.stepTimeoutMs = options.stepTimeoutMs;
  }
  return runPipeline(options.pipeline, options.input, runOptions);
}

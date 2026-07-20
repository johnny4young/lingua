/**
 * implementation — renderer-side pipeline runner.
 *
 * Thin wrapper around `runPipeline` (in `src/shared/utilityPipeline.ts`)
 * that surfaces per-step results as a React-friendly array via the
 * `onStepSettled` callback. The hook layer
 * (`src/renderer/hooks/useUtilityPipelineRun.ts`) wraps this into a
 * `{idle | running | settled}` state machine.
 *
 * The runner is its own module (not just inlined in the hook) so
 * future internal CLI Companion can reuse it for `lingua pipeline run`
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
  // Count the steps the worker managed to stream so a mid-run worker
  // failure can fall back inline without re-emitting them (steps are
  // deterministic text transforms, so the inline prefix matches).
  let workerStepsForwarded = 0;
  let workerOutcome: PipelineRunOutcome | null = null;
  try {
    workerOutcome = await runPipelineOffThread({
      pipeline: options.pipeline,
      input: options.input,
      ...(options.onStepSettled
        ? {
            onStepSettled: (result: PipelineStepResult) => {
              workerStepsForwarded += 1;
              options.onStepSettled?.(result);
            },
          }
        : {}),
      ...(options.stepTimeoutMs === undefined
        ? {}
        : { stepTimeoutMs: options.stepTimeoutMs }),
      ...(options.workerFactory ? { workerFactory: options.workerFactory } : {}),
    });
  } catch {
    // Worker crash or protocol error — the pipeline contract is that this
    // runner always settles, so leave workerOutcome null and fall through
    // to the inline path.
  }
  if (workerOutcome) return workerOutcome;

  const runOptions: RunPipelineOptions = {};
  if (options.onStepSettled) {
    const forward = options.onStepSettled;
    let inlineStepIndex = 0;
    runOptions.onStepSettled = (result) => {
      inlineStepIndex += 1;
      if (inlineStepIndex <= workerStepsForwarded) return;
      forward(result);
    };
  }
  if (options.stepTimeoutMs !== undefined) {
    runOptions.stepTimeoutMs = options.stepTimeoutMs;
  }
  return runPipeline(options.pipeline, options.input, runOptions);
}

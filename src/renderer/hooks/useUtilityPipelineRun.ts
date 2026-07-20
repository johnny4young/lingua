/**
 * implementation — `useUtilityPipelineRun` hook.
 *
 * State machine `{idle | running | settled}` over the pipeline
 * runner. Components subscribe to the streaming step results array
 * and the aggregate outcome.
 *
 * Lives as its own hook (not inlined in `<UtilityPipelinePanel>`) so
 * future surfaces (e.g. a "Run this pipeline against the current
 * editor selection" command) can reuse it.
 */

import { useCallback, useRef, useState } from 'react';
import {
  type PipelineRunOutcome,
  type PipelineStepResult,
  type UtilityPipelineV1,
} from '../../shared/utilityPipeline';
import { runUtilityPipeline } from '../runtime/utilityPipelineRunner';

export type PipelineRunPhase = 'idle' | 'running' | 'settled';

export interface PipelineRunState {
  phase: PipelineRunPhase;
  /** Streamed per-step results so far. Mirrored to `outcome.results` on settle. */
  stepResults: PipelineStepResult[];
  /** Aggregate outcome — null until `phase === 'settled'`. */
  outcome: PipelineRunOutcome | null;
}

export interface UseUtilityPipelineRunResult {
  state: PipelineRunState;
  run: (pipeline: UtilityPipelineV1, input: string) => Promise<PipelineRunOutcome | null>;
  reset: () => void;
}

export function useUtilityPipelineRun(): UseUtilityPipelineRunResult {
  const [state, setState] = useState<PipelineRunState>({
    phase: 'idle',
    stepResults: [],
    outcome: null,
  });
  // Run id guards against concurrent runs: a stale streaming result
  // from a previous run never overwrites the active state.
  const runIdRef = useRef(0);

  const run = useCallback(
    async (pipeline: UtilityPipelineV1, input: string) => {
      runIdRef.current += 1;
      const runId = runIdRef.current;
      const streamed: PipelineStepResult[] = [];
      setState({ phase: 'running', stepResults: [], outcome: null });
      try {
        const outcome = await runUtilityPipeline({
          pipeline,
          input,
          onStepSettled: (result) => {
            if (runId !== runIdRef.current) return;
            streamed.push(result);
            setState((prev) => {
              if (prev.phase !== 'running') return prev;
              return { ...prev, stepResults: streamed.slice() };
            });
          },
        });
        if (runId !== runIdRef.current) return null;
        setState({
          phase: 'settled',
          stepResults: outcome.results,
          outcome,
        });
        return outcome;
      } catch {
        if (runId !== runIdRef.current) return null;
        setState({ phase: 'settled', stepResults: streamed.slice(), outcome: null });
        return null;
      }
    },
    []
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState({ phase: 'idle', stepResults: [], outcome: null });
  }, []);

  return { state, run, reset };
}

import { createBlankPipeline, createBlankStep, PIPELINE_CAP } from '../../shared/utilityPipeline';
import type { UtilityAdapterId } from '../../shared/utilities/types';
import { useUtilityPipelineStore } from './utilityPipelineStore';

/** A new pipeline that runs `utilityId` on `output`; false at the library cap, as it would evict one. */
export function sendOutputToNewPipeline(output: string, utilityId: UtilityAdapterId, name: string): boolean {
  const store = useUtilityPipelineStore.getState();
  if (store.pipelines.length >= PIPELINE_CAP) return false;
  const pipeline = createBlankPipeline({ id: crypto.randomUUID(), name });
  pipeline.steps.push(createBlankStep({ id: crypto.randomUUID(), utilityId }));
  store.createPipeline(pipeline);
  store.setPipelineInput(pipeline.id, output);
  store.setPendingRunPipelineId(pipeline.id);
  return true;
}

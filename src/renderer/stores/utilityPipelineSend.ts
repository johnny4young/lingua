import { createBlankPipeline, createBlankStep, PIPELINE_CAP } from '../../shared/utilityPipeline';
import type { UtilityAdapterId } from '../../shared/utilities/types';
import { useUtilityPipelineStore } from './utilityPipelineStore';

/** A new pipeline that runs `utilityId` on `output`; false at the library cap, as it would evict one. */
export function sendOutputToNewPipeline(
  output: string,
  utilityId: UtilityAdapterId,
  name: string,
  sourceToolId?: string
): boolean {
  const store = useUtilityPipelineStore.getState();
  if (store.pipelines.length >= PIPELINE_CAP) return false;
  const pipeline = createBlankPipeline({ id: crypto.randomUUID(), name });
  pipeline.steps.push(createBlankStep({ id: crypto.randomUUID(), utilityId }));
  if (sourceToolId) pipeline.sourceToolId = sourceToolId;
  // The input goes first: writing an input drops the source of a pipeline that has one.
  store.setPipelineInput(pipeline.id, output);
  store.createPipeline(pipeline);
  store.setPendingRunPipelineId(pipeline.id);
  return true;
}

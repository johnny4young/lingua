/**
 * implementation note — Utility pipeline telemetry helper.
 *
 * Single event: `utility.pipeline_executed { stepCount, status }`.
 *
 *   - `stepCount` reuses the existing `DEPENDENCY_COUNT_BUCKETS_SET`
 *     enum so the bucket vocabulary stays consistent across events.
 *   - `status` is the closed `PIPELINE_RUN_STATUSES` aggregate from
 *     the engine — `'all-ok' | 'partial' | 'all-failed' | 'incompatible'`.
 *
 * NO step contents, NO utility ids, NO input/output values reach
 * the wire — only the bucketed step count + the aggregate status.
 * Mirrored on `update-server/src/telemetry.ts` with parity test.
 */

import {
  bucketStepCount,
  type PipelineRunOutcome,
} from '../../shared/utilityPipeline';
import { trackEvent } from '../utils/telemetry';

export function trackUtilityPipelineExecuted(outcome: PipelineRunOutcome): void {
  void trackEvent('utility.pipeline_executed', {
    stepCount: bucketStepCount(outcome.results.length),
    status: outcome.status,
  });
}

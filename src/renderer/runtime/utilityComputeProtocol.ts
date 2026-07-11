import type {
  PipelineRunOutcome,
  PipelineStepResult,
  UtilityPipelineV1,
} from '../../shared/utilityPipeline';
import type { DiffGranularity, DiffSegment } from '../utils/diff';

export type UtilityComputeRequest =
  | {
      readonly type: 'diff';
      readonly requestId: string;
      readonly left: string;
      readonly right: string;
      readonly granularity: DiffGranularity;
    }
  | {
      readonly type: 'pipeline';
      readonly requestId: string;
      readonly pipeline: UtilityPipelineV1;
      readonly input: string;
      readonly stepTimeoutMs?: number;
    };

export type UtilityComputeResponse =
  | {
      readonly type: 'diff-result';
      readonly requestId: string;
      readonly segments: DiffSegment[];
    }
  | {
      readonly type: 'pipeline-step';
      readonly requestId: string;
      readonly result: PipelineStepResult;
    }
  | {
      readonly type: 'pipeline-result';
      readonly requestId: string;
      readonly outcome: PipelineRunOutcome;
    }
  | {
      readonly type: 'error';
      readonly requestId: string;
      readonly message: string;
    };

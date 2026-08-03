/** Dependency-free persisted contracts for sequential HTTP request pipelines. */

export const HTTP_PIPELINE_MAX_STEPS = 20;
export const HTTP_PIPELINE_MAX_COUNT = 50;

interface HttpPipelineStepV1 {
  readonly id: string;
  readonly requestId: string;
  readonly enabled: boolean;
}

export interface HttpPipelineV1 {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly steps: ReadonlyArray<HttpPipelineStepV1>;
  readonly stopOnFailure: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type HttpPipelineStepStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped';

export interface HttpPipelineStepResult {
  readonly stepId: string;
  readonly requestId: string;
  readonly status: Exclude<HttpPipelineStepStatus, 'pending' | 'running'>;
  readonly responseKind?: string;
  readonly httpStatus?: number;
  readonly assertionFailures?: number;
  readonly message?: string;
}

export interface HttpPipelineRunSnapshot {
  readonly pipelineId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly phase: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly activeStepId?: string;
  readonly results: ReadonlyArray<HttpPipelineStepResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStep(value: unknown): HttpPipelineStepV1 | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    return null;
  }
  if (typeof value.enabled !== 'boolean') return null;
  return { id: value.id, requestId: value.requestId, enabled: value.enabled };
}

export function parseHttpPipeline(value: unknown): HttpPipelineV1 | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.name !== 'string') return null;
  if (!Array.isArray(value.steps) || value.steps.length > HTTP_PIPELINE_MAX_STEPS) {
    return null;
  }
  const steps: HttpPipelineStepV1[] = [];
  const stepIds = new Set<string>();
  for (const raw of value.steps) {
    const step = parseStep(raw);
    if (!step || stepIds.has(step.id)) return null;
    stepIds.add(step.id);
    steps.push(step);
  }
  if (typeof value.stopOnFailure !== 'boolean') return null;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    return null;
  }
  return {
    version: 1,
    id: value.id,
    name: value.name,
    steps,
    stopOnFailure: value.stopOnFailure,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function createBlankHttpPipeline(options: {
  id: string;
  name?: string;
  now?: string;
}): HttpPipelineV1 {
  const now = options.now ?? new Date().toISOString();
  return {
    version: 1,
    id: options.id,
    name: options.name ?? '',
    steps: [],
    stopOnFailure: true,
    createdAt: now,
    updatedAt: now,
  };
}

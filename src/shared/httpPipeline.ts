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

/** Why a step has no response: the runner's closed vocabulary, read by the step row. */
type HttpPipelineStepMessage = 'missing-request' | 'live-transport' | 'no-response' | 'cancelled' | 'stopped-on-failure';

export interface HttpPipelineStepResult {
  readonly stepId: string;
  readonly requestId: string;
  readonly status: Exclude<HttpPipelineStepStatus, 'pending' | 'running'>;
  readonly responseKind?: string;
  readonly httpStatus?: number;
  readonly assertionFailures?: number;
  readonly message?: HttpPipelineStepMessage;
  /** What a run read off the response; set only where the response arrived. */
  readonly report?: HttpPipelineStepReport;
}

/** One value a step wrote into a variable; `value` is absent when it looks secret. */
export interface HttpPipelineCapture {
  readonly variable: string;
  /** Where it came from, written as code: `body.id`, `header etag`, `status`. */
  readonly from: string;
  readonly value?: string;
}

/** The check a step row reads out: the first failing assertion, else the first one. */
interface HttpPipelineCheck {
  readonly expression: string;
  readonly pass: boolean;
  /** The value the response gave, as a literal; absent when it had none. */
  readonly received?: string;
  /** Enabled assertions on the step, this one included. */
  readonly count: number;
}

export interface HttpPipelineStepReport {
  readonly durationMs: number;
  readonly statusText: string;
  readonly captures: ReadonlyArray<HttpPipelineCapture>;
  readonly check?: HttpPipelineCheck;
  readonly snapshotChanged?: boolean;
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

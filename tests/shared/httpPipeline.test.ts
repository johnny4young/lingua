import { describe, expect, it } from 'vitest';
import {
  HTTP_PIPELINE_MAX_STEPS,
  createBlankHttpPipeline,
  parseHttpPipeline,
} from '../../src/shared/httpPipeline';

describe('HTTP pipeline schema', () => {
  it('creates a bounded, stop-on-failure pipeline', () => {
    const pipeline = createBlankHttpPipeline({
      id: 'pipeline-1',
      name: 'Login flow',
      now: '2026-08-01T00:00:00.000Z',
    });
    expect(pipeline).toMatchObject({
      version: 1,
      id: 'pipeline-1',
      name: 'Login flow',
      steps: [],
      stopOnFailure: true,
    });
    expect(parseHttpPipeline(pipeline)).toEqual(pipeline);
  });

  it('rejects duplicate step ids and oversized pipelines', () => {
    const base = createBlankHttpPipeline({ id: 'pipeline-1' });
    const duplicate = {
      ...base,
      steps: [
        { id: 'step', requestId: 'a', enabled: true },
        { id: 'step', requestId: 'b', enabled: true },
      ],
    };
    expect(parseHttpPipeline(duplicate)).toBeNull();
    expect(
      parseHttpPipeline({
        ...base,
        steps: Array.from({ length: HTTP_PIPELINE_MAX_STEPS + 1 }, (_, index) => ({
          id: `step-${index}`,
          requestId: `request-${index}`,
          enabled: true,
        })),
      })
    ).toBeNull();
  });
});

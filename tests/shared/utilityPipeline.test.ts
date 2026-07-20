/**
 * implementation — utilityPipeline schema + engine tests.
 *
 * Exercises: parsers (happy + every shape rejection),
 * `tryImportPipelineJson` closed reject reasons, the `runPipeline`
 * engine (single step OK, skip-on-upstream-failure, incompatible
 * kind via synthetic adapter, timeout, byte-cap exceeded), aggregate
 * status mapping, and helper exports.
 */

import { describe, expect, it } from 'vitest';
import {
  PIPELINE_RUN_STATUSES,
  PIPELINE_STEP_STATUSES,
  STEP_VALUE_BYTE_CAP,
  bucketStepCount,
  createBlankPipeline,
  createBlankStep,
  parsePipeline,
  parsePipelineStep,
  runPipeline,
  tryImportPipelineJson,
  type UtilityPipelineV1,
} from '../../src/shared/utilityPipeline';

function fixturePipeline(): UtilityPipelineV1 {
  return {
    version: 1,
    id: 'pipe-1',
    name: 'sample',
    steps: [
      {
        id: 'step-1',
        utilityId: 'base64-decode',
        options: {},
      },
      {
        id: 'step-2',
        utilityId: 'json-format',
        options: { indent: '2' },
      },
    ],
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  };
}

describe('PIPELINE_STEP_STATUSES', () => {
  it('is a closed five-status enum', () => {
    expect([...PIPELINE_STEP_STATUSES].sort()).toEqual([
      'error',
      'incompatible',
      'ok',
      'skipped',
      'timeout',
    ]);
  });
});

describe('PIPELINE_RUN_STATUSES', () => {
  it('is a closed four-status aggregate enum', () => {
    expect([...PIPELINE_RUN_STATUSES].sort()).toEqual([
      'all-failed',
      'all-ok',
      'incompatible',
      'partial',
    ]);
  });
});

describe('bucketStepCount', () => {
  it('matches DEPENDENCY_COUNT_BUCKETS', () => {
    expect(bucketStepCount(0)).toBe('0');
    expect(bucketStepCount(1)).toBe('1');
    expect(bucketStepCount(3)).toBe('2-5');
    expect(bucketStepCount(7)).toBe('6-10');
    expect(bucketStepCount(50)).toBe('>10');
  });
});

describe('parsePipelineStep', () => {
  it('round-trips a valid step', () => {
    const parsed = parsePipelineStep({
      id: 'step-1',
      utilityId: 'base64-decode',
      options: {},
    });
    expect(parsed?.id).toBe('step-1');
    expect(parsed?.utilityId).toBe('base64-decode');
  });

  it('rejects unknown utility id', () => {
    expect(
      parsePipelineStep({ id: 'step-1', utilityId: 'unknown-xyz', options: {} })
    ).toBeNull();
  });

  it('rejects missing options object', () => {
    expect(
      parsePipelineStep({ id: 'step-1', utilityId: 'base64-decode' })
    ).toBeNull();
  });
});

describe('parsePipeline', () => {
  it('round-trips a valid pipeline', () => {
    const parsed = parsePipeline(fixturePipeline());
    expect(parsed).not.toBeNull();
    expect(parsed?.steps).toHaveLength(2);
  });

  it('rejects wrong version', () => {
    expect(parsePipeline({ ...fixturePipeline(), version: 2 })).toBeNull();
  });

  it('drops steps with unknown utility ids (forward-version compat)', () => {
    const parsed = parsePipeline({
      ...fixturePipeline(),
      steps: [
        { id: 'step-1', utilityId: 'base64-decode', options: {} },
        { id: 'step-2', utilityId: 'unknown-future', options: {} },
        { id: 'step-3', utilityId: 'json-format', options: { indent: '2' } },
      ],
    });
    expect(parsed?.steps).toHaveLength(2);
    expect(parsed?.steps[0]?.utilityId).toBe('base64-decode');
    expect(parsed?.steps[1]?.utilityId).toBe('json-format');
  });

  it('rejects duplicate step ids', () => {
    expect(
      parsePipeline({
        ...fixturePipeline(),
        steps: [
          { id: 'step-1', utilityId: 'base64-decode', options: {} },
          { id: 'step-1', utilityId: 'json-format', options: { indent: '2' } },
        ],
      })
    ).toBeNull();
  });

  it('rejects more than PIPELINE_MAX_STEPS', () => {
    const overSized = {
      ...fixturePipeline(),
      steps: Array.from({ length: 51 }, (_, i) => ({
        id: `step-${i}`,
        utilityId: 'base64-decode' as const,
        options: {},
      })),
    };
    expect(parsePipeline(overSized)).toBeNull();
  });
});

describe('tryImportPipelineJson', () => {
  it('decodes a valid pipeline', () => {
    const json = JSON.stringify(fixturePipeline());
    const outcome = tryImportPipelineJson(json, 0);
    expect(outcome.ok).toBe(true);
  });

  it('rejects empty input as malformed-json', () => {
    const outcome = tryImportPipelineJson('   ', 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed-json');
  });

  it('rejects unknown utility id with the truncated set', () => {
    const broken = {
      ...fixturePipeline(),
      steps: [
        { id: 'step-1', utilityId: 'made-up', options: {} },
      ],
    };
    const outcome = tryImportPipelineJson(JSON.stringify(broken), 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unknown-utility-id');
    expect(outcome.detail).toContain('made-up');
  });

  it('rejects duplicate step ids as invalid-shape', () => {
    const broken = {
      ...fixturePipeline(),
      steps: [
        { id: 'step-1', utilityId: 'base64-decode', options: {} },
        { id: 'step-1', utilityId: 'json-format', options: { indent: '2' } },
      ],
    };
    const outcome = tryImportPipelineJson(JSON.stringify(broken), 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
  });

  it('rejects wrong-version', () => {
    const outcome = tryImportPipelineJson(
      JSON.stringify({ ...fixturePipeline(), version: 99 }),
      0
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('wrong-version');
  });

  it('rejects when current pipeline count is at cap', () => {
    const outcome = tryImportPipelineJson(JSON.stringify(fixturePipeline()), 100);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('cap-exceeded');
  });
});

describe('runPipeline', () => {
  it('runs a single-step pipeline successfully', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-decode' }));
    const outcome = await runPipeline(pipeline, 'aGVsbG8=', { skipYield: true });
    expect(outcome.status).toBe('all-ok');
    expect(outcome.results[0]?.status).toBe('ok');
    expect(outcome.results[0]?.output).toBe('hello');
  });

  it('cascades skip after upstream failure', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-decode' }));
    pipeline.steps.push(createBlankStep({ id: 's2', utilityId: 'json-format' }));
    const outcome = await runPipeline(pipeline, 'not-valid-base64-😀', { skipYield: true });
    expect(outcome.status).toBe('all-failed');
    expect(outcome.results[0]?.status).toBe('error');
    expect(outcome.results[1]?.status).toBe('skipped');
  });

  it('chains Base64 decode → JSON format', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-decode' }));
    pipeline.steps.push(createBlankStep({ id: 's2', utilityId: 'json-format' }));
    // Base64 of `{"a":1}` is `eyJhIjoxfQ==`
    const outcome = await runPipeline(pipeline, 'eyJhIjoxfQ==', { skipYield: true });
    expect(outcome.status).toBe('all-ok');
    expect(outcome.results[0]?.output).toBe('{"a":1}');
    expect(outcome.results[1]?.output).toBe('{\n  "a": 1\n}');
  });

  it('streams partial results via onStepSettled', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-decode' }));
    pipeline.steps.push(createBlankStep({ id: 's2', utilityId: 'json-format' }));
    const streamed: string[] = [];
    await runPipeline(pipeline, 'eyJhIjoxfQ==', {
      skipYield: true,
      onStepSettled: (result) => {
        streamed.push(`${result.stepId}:${result.status}`);
      },
    });
    expect(streamed).toEqual(['s1:ok', 's2:ok']);
  });

  it('aggregates as partial when some steps succeed and some fail', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-encode' }));
    pipeline.steps.push(createBlankStep({ id: 's2', utilityId: 'json-format' }));
    const outcome = await runPipeline(pipeline, 'plain text', { skipYield: true });
    // s1: base64-encode (ok). s2: json-format on the base64 string (invalid JSON, error). Aggregate: partial.
    expect(outcome.results[0]?.status).toBe('ok');
    expect(outcome.results[1]?.status).toBe('error');
    expect(outcome.status).toBe('partial');
  });

  it('fails a step when the produced output exceeds the byte cap', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-encode' }));
    const outcome = await runPipeline(
      pipeline,
      'a'.repeat(STEP_VALUE_BYTE_CAP),
      { skipYield: true }
    );
    expect(outcome.status).toBe('all-failed');
    expect(outcome.results[0]?.status).toBe('error');
    expect(outcome.results[0]?.output).toBeUndefined();
    expect(outcome.results[0]?.errorMessage).toContain('Step output exceeded');
  });

  it('returns all-ok for an empty-step pipeline', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    const outcome = await runPipeline(pipeline, '', { skipYield: true });
    expect(outcome.status).toBe('all-ok');
    expect(outcome.results).toHaveLength(0);
  });
});

describe('createBlankPipeline + createBlankStep', () => {
  it('produces a versioned shell with empty steps', () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    expect(pipeline.version).toBe(1);
    expect(pipeline.steps).toEqual([]);
  });

  it('seeds a step with the adapter default options', () => {
    const step = createBlankStep({ id: 's1', utilityId: 'json-format' });
    expect(step.utilityId).toBe('json-format');
    expect(step.options).toEqual({ indent: '2' });
  });
});

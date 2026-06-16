/**
 * RL-099 Slice 3 — `pipelineCapsule.ts` mapping rules.
 *
 * Pinned coverage:
 *   - all-ok → capsule status 'success'; partial / all-failed /
 *     incompatible → 'error' (all 4 run-status mappings).
 *   - source.content is the RECIPE ONLY — the input data is never in it
 *     (fold F) — and is order-stable / content-hash stable.
 *   - result.stdout is the FINAL output (last 'ok' step's output).
 *   - result.stderr is the compact failed-step summary (fold D),
 *     omitted when no step failed.
 *   - result.durationMs mirrors the run total.
 *   - input passthrough rides input.stdin.
 *   - tab.language === 'pipeline'; environment.runner === 'utility-pipeline'.
 */

import { describe, expect, it } from 'vitest';
import { buildPipelineCapsule } from '../../../src/renderer/runtime/pipelineCapsule';
import type {
  PipelineRunOutcome,
  PipelineStepResult,
  PipelineStepV1,
} from '../../../src/shared/utilityPipeline';
import type { UtilityAdapterId } from '../../../src/shared/utilities/types';

function makeStep(
  utilityId: UtilityAdapterId,
  options: Record<string, unknown> = {}
): PipelineStepV1 {
  return { id: `step-${utilityId}`, utilityId, options };
}

function okResult(
  utilityId: UtilityAdapterId,
  output: string,
  durationMs = 5
): PipelineStepResult {
  return { stepId: `step-${utilityId}`, utilityId, status: 'ok', output, durationMs };
}

function makeOutcome(overrides: Partial<PipelineRunOutcome> = {}): PipelineRunOutcome {
  return {
    status: 'all-ok',
    results: [okResult('base64-decode', '{"a":1}'), okResult('json-format', '{\n  "a": 1\n}')],
    durationMs: 42,
    ...overrides,
  };
}

const ARGS = {
  appVersion: '0.5.0',
  pipelineName: 'demo pipeline',
  platform: 'web' as const,
};

describe('buildPipelineCapsule (RL-099 Slice 3 fold A bridge)', () => {
  it('maps all-ok run to capsule status "success"', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('base64-decode'), makeStep('json-format')],
      input: 'eyJhIjoxfQ==',
      outcome: makeOutcome({ status: 'all-ok' }),
    });
    expect(capsule.result.status).toBe('success');
  });

  it('maps partial run to capsule status "error"', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format'), makeStep('base64-encode')],
      input: 'x',
      outcome: makeOutcome({ status: 'partial' }),
    });
    expect(capsule.result.status).toBe('error');
  });

  it('maps all-failed run to capsule status "error"', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'not-json',
      outcome: makeOutcome({
        status: 'all-failed',
        results: [
          {
            stepId: 'step-json-format',
            utilityId: 'json-format',
            status: 'error',
            errorMessage: 'Unexpected token',
            durationMs: 3,
          },
        ],
      }),
    });
    expect(capsule.result.status).toBe('error');
  });

  it('maps incompatible run to capsule status "error"', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({
        status: 'incompatible',
        results: [
          {
            stepId: 'step-json-format',
            utilityId: 'json-format',
            status: 'incompatible',
            errorMessage: 'Expected text; got binary',
            durationMs: 0,
          },
        ],
      }),
    });
    expect(capsule.result.status).toBe('error');
  });

  it('pins tab.language, runtimeMode, and environment.runner', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome(),
    });
    expect(capsule.tab.language).toBe('pipeline');
    expect(capsule.tab.runtimeMode).toBe('utility-pipeline');
    expect(capsule.tab.workflowMode).toBe('run');
    expect(capsule.environment.runner).toBe('utility-pipeline');
  });

  it('falls back to a neutral tab name when the pipeline is unnamed', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      pipelineName: '   ',
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome(),
    });
    expect(capsule.tab.name).toBe('Utility pipeline');
  });

  it('serializes the RECIPE ONLY — the input data is never in source.content (fold F)', async () => {
    const secretInput = 'SUPER-SECRET-INPUT-PAYLOAD-12345';
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('base64-decode'), makeStep('json-format', { indent: 2 })],
      input: secretInput,
      outcome: makeOutcome(),
    });
    // The recipe header + one line per step are present…
    expect(capsule.source.content).toContain('# Lingua utility pipeline capsule v1');
    expect(capsule.source.content).toContain('#1 base64-decode');
    expect(capsule.source.content).toContain('#2 json-format {"indent":2}');
    // …but the input data is NOT in the recipe (it rides input.stdin).
    expect(capsule.source.content).not.toContain(secretInput);
    // The step OUTPUTS are likewise never in the recipe.
    expect(capsule.source.content).not.toContain('{\n  "a": 1\n}');
  });

  it('produces an order-stable, content-hash-stable recipe', async () => {
    const steps = [makeStep('base64-decode'), makeStep('json-format', { indent: 2 })];
    const a = await buildPipelineCapsule({
      ...ARGS,
      steps,
      input: 'one',
      outcome: makeOutcome(),
    });
    const b = await buildPipelineCapsule({
      ...ARGS,
      steps,
      // Different input + different outcome durations — the recipe hash
      // must NOT change, because neither is part of the recipe.
      input: 'two',
      outcome: makeOutcome({ durationMs: 999 }),
    });
    expect(b.source.contentHash).toBe(a.source.contentHash);
  });

  it('changes the content-hash when the step order changes', async () => {
    const forward = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('base64-decode'), makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome(),
    });
    const reversed = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format'), makeStep('base64-decode')],
      input: 'x',
      outcome: makeOutcome(),
    });
    expect(reversed.source.contentHash).not.toBe(forward.source.contentHash);
  });

  it('uses the LAST ok step output as the final stdout', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('base64-decode'), makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({
        status: 'all-ok',
        results: [
          okResult('base64-decode', 'INTERMEDIATE'),
          okResult('json-format', 'FINAL-OUTPUT'),
        ],
      }),
    });
    expect(capsule.result.stdout).toBe('FINAL-OUTPUT');
  });

  it('falls back to the last surviving ok output on a partial run (trailing failure)', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('base64-decode'), makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({
        status: 'partial',
        results: [
          okResult('base64-decode', 'GOOD-INTERMEDIATE'),
          {
            stepId: 'step-json-format',
            utilityId: 'json-format',
            status: 'error',
            errorMessage: 'boom',
            durationMs: 1,
          },
        ],
      }),
    });
    expect(capsule.result.stdout).toBe('GOOD-INTERMEDIATE');
  });

  it('omits stdout when no step produced an output', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({
        status: 'all-failed',
        results: [
          {
            stepId: 'step-json-format',
            utilityId: 'json-format',
            status: 'error',
            errorMessage: 'boom',
            durationMs: 1,
          },
        ],
      }),
    });
    expect(capsule.result.stdout).toBeUndefined();
  });

  it('summarizes failed steps onto stderr (fold D)', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('base64-decode'), makeStep('json-format'), makeStep('base64-encode')],
      input: 'x',
      outcome: makeOutcome({
        status: 'partial',
        results: [
          okResult('base64-decode', 'ok'),
          {
            stepId: 'step-json-format',
            utilityId: 'json-format',
            status: 'error',
            errorMessage: 'Unexpected token',
            durationMs: 2,
          },
          {
            stepId: 'step-base64-encode',
            utilityId: 'base64-encode',
            status: 'timeout',
            errorMessage: 'Step exceeded 30000 ms',
            durationMs: 30000,
          },
        ],
      }),
    });
    expect(capsule.result.stderr).toBe(
      '#2 json-format: Unexpected token\n#3 base64-encode: Step exceeded 30000 ms'
    );
  });

  it('falls back to the status string when a failed step has no errorMessage', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({
        status: 'all-failed',
        results: [
          {
            stepId: 'step-json-format',
            utilityId: 'json-format',
            status: 'error',
            durationMs: 1,
          },
        ],
      }),
    });
    expect(capsule.result.stderr).toBe('#1 json-format: error');
  });

  it('omits stderr when every step succeeded', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({ status: 'all-ok' }),
    });
    expect(capsule.result.stderr).toBeUndefined();
  });

  it('mirrors the run total onto result.durationMs', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'x',
      outcome: makeOutcome({ durationMs: 1234 }),
    });
    expect(capsule.result.durationMs).toBe(1234);
  });

  it('passes the input through to input.stdin (not source.content)', async () => {
    const capsule = await buildPipelineCapsule({
      ...ARGS,
      steps: [makeStep('json-format')],
      input: 'PIPELINE-INPUT-STRING',
      outcome: makeOutcome(),
    });
    expect(capsule.input.stdin).toBe('PIPELINE-INPUT-STRING');
    expect(capsule.source.content).not.toContain('PIPELINE-INPUT-STRING');
  });
});

/** What one pipeline step read off its response: time, captures and the check its row reads out. */

import { splitVariableTokens } from '../../../shared/httpEnvironment';
import { isSecretCapture, secretCaptureValues } from '../../../shared/httpPersistedSecrets';
import type {
  HttpPipelineCapture,
  HttpPipelineRunSnapshot,
  HttpPipelineStepReport,
  HttpPipelineV1,
} from '../../../shared/httpPipeline';
import { runAssertions } from '../../../shared/httpWorkspaceAssertions';
import { extractCaptureValue, parseJsonBodyOnce } from '../../../shared/httpWorkspaceCaptures';
import type { HttpRequestV1, HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { snapshotChanges } from '../../../shared/httpSnapshot';
import { MASKED_VALUE } from './httpScopeColors';
import { answerAssertion, assertionExpression, literalKind, sourceExpression } from './httpTestLines';

const LITERAL_MAX = 120;

/** `https://api.example.com/v1/x` and `{{baseUrl}}/v1/x` both read `/v1/x`: the host lives in the environment. */
export function shownPath(url: string): string {
  const trimmed = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(trimmed);
  if (scheme) return trimmed.slice(scheme[0].length) || '/';
  const [head, next] = splitVariableTokens(trimmed);
  const hostVariable = head?.key !== undefined && (next === undefined || /^[/?#]/.test(next.text));
  return hostVariable ? trimmed.slice(head.text.length) || '/' : trimmed;
}

/** A value as code reads it: strings quoted, numbers, booleans and null bare. */
export function literalText(value: unknown): string {
  const text =
    typeof value === 'string'
      ? JSON.stringify(value)
      : value === undefined
        ? ''
        : (JSON.stringify(value) ?? String(value));
  return text.length > LITERAL_MAX ? `${text.slice(0, LITERAL_MAX - 1)}…` : text;
}

/** The rules that write a variable: enabled, with a target. */
export function enabledCaptures(request: HttpRequestV1 | undefined) {
  return (request?.captures ?? []).filter(rule => rule.enabled && rule.targetVariable.trim().length > 0);
}

function capturesOf(request: HttpRequestV1, response: HttpResponseV1, secretKeys: ReadonlySet<string>): HttpPipelineCapture[] {
  return enabledCaptures(request).flatMap(rule => {
    const variable = rule.targetVariable.trim();
    const value = extractCaptureValue(response, rule);
    if (value === null) return [];
    const secret = isSecretCapture({ targetVariable: variable, value }, secretKeys);
    // Captured text keeps its JSON type where it has one: 3 stays a number, "3" would not.
    const shown = literalKind(value) === 'string' ? literalText(value) : value;
    return [{ variable, from: sourceExpression(rule), ...(secret ? {} : { value: shown }) }];
  });
}

/** Reads a settled step; `passed` folds the transport, assertions and a pending snapshot diff. */
export function readPipelineStep(
  request: HttpRequestV1,
  response: HttpResponseV1,
  secretKeys: ReadonlySet<string>
): { passed: boolean; assertionFailures: number; report: HttpPipelineStepReport } {
  const assertions = (request.assertions ?? []).filter(assertion => assertion.enabled);
  const results = runAssertions(response, assertions);
  const failures = results.filter(result => !result.pass).length;
  const shownIndex = Math.max(
    0,
    results.findIndex(result => !result.pass)
  );
  const shown = assertions[shownIndex];
  const result = results[shownIndex];
  let check: HttpPipelineStepReport['check'];
  if (shown && result) {
    const body = shown.source === 'body-json' ? parseJsonBodyOnce(response) : null;
    const answer = answerAssertion(response, body, shown, result);
    // A token this step just captured is not a known secret yet, so the mask catches it here, also inside an object.
    const raw = typeof answer.value === 'string' ? answer.value : (JSON.stringify(answer.value) ?? '');
    const secret = secretCaptureValues(response, request.captures ?? [], secretKeys).some(value => raw.includes(value));
    check = {
      expression: assertionExpression(shown),
      pass: result.pass,
      count: assertions.length,
      ...(answer.value !== undefined ? { received: secret ? MASKED_VALUE : literalText(answer.value) } : {}),
    };
  }
  const snapshotChanged =
    request.snapshot !== undefined && snapshotChanges(request.snapshot, response).length > 0;
  return {
    passed: response.kind === 'success' && failures === 0 && !snapshotChanged,
    assertionFailures: failures,
    report: {
      durationMs: Math.max(0, Math.round(response.durationMs)),
      statusText: response.statusText,
      captures: response.kind === 'success' ? capturesOf(request, response, secretKeys) : [],
      ...(check ? { check } : {}),
      ...(snapshotChanged ? { snapshotChanged } : {}),
    },
  };
}

/** Where a run halted, as a pipeline position (1-based), for the header's meta line. */
interface PipelineRunHalt {
  readonly key: 'runningStep' | 'stoppedAt' | 'cancelledAt';
  readonly index: number;
}

export interface PipelineRunSummary {
  readonly passed: number;
  /** Steps the run covers: the enabled ones. */
  readonly total: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly halt: PipelineRunHalt | null;
  readonly segments: ReadonlyArray<{ key: string; ms: number; failed: boolean }>;
}

/** Reads a run against the pipeline on screen; positions follow the pipeline's order. */
export function summarizePipelineRun(pipeline: HttpPipelineV1, run: HttpPipelineRunSnapshot): PipelineRunSummary {
  const at = (key: PipelineRunHalt['key'], stepId: string | undefined): PipelineRunHalt | null => {
    const index = pipeline.steps.findIndex(step => step.id === stepId);
    return index === -1 ? null : { key, index: index + 1 };
  };
  const segments = run.results.flatMap(result =>
    result.report ? [{ key: result.stepId, ms: result.report.durationMs, failed: result.status === 'failed' }] : []
  );
  const lastFailed = [...run.results].reverse().find(result => result.status === 'failed');
  const cancelled = run.results.find(result => result.message === 'cancelled');
  const halt =
    run.phase === 'running'
      ? at('runningStep', run.activeStepId)
      : run.results.some(result => result.message === 'stopped-on-failure')
        ? at('stoppedAt', lastFailed?.stepId)
        : cancelled
          ? at('cancelledAt', cancelled.stepId)
          : null;
  return {
    passed: run.results.filter(result => result.status === 'passed').length,
    total: run.phase === 'running' ? pipeline.steps.filter(step => step.enabled).length : run.results.length,
    totalMs: segments.reduce((sum, segment) => sum + segment.ms, 0),
    maxMs: segments.reduce((max, segment) => Math.max(max, segment.ms), 0),
    halt,
    segments,
  };
}

import { describe, expect, it } from 'vitest';
import {
  literalText,
  pipelineHost,
  readPipelineStep,
  shownPath,
  summarizePipelineRun,
} from '../../../src/renderer/components/HttpWorkspace/httpPipelineReport';
import type { HttpPipelineRunSnapshot, HttpPipelineV1 } from '../../../src/shared/httpPipeline';
import { createBlankHttpRequest, type HttpRequestV1, type HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

function response(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 201,
    statusText: 'Created',
    url: 'https://api.example.com/v1/deploys',
    finalUrl: 'https://api.example.com/v1/deploys',
    headers: [{ name: 'etag', value: 'W/"7"' }],
    body: '{"id":"dep_81f2","count":3,"items":[{"status":"degraded"}],"token":"short"}',
    contentType: 'application/json',
    sizeBytes: 80,
    durationMs: 411.6,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

function request(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return { ...createBlankHttpRequest({ id: 'r1', name: 'Create deploy' }), url: '{{baseUrl}}/v1/deploys', ...overrides };
}

const capture = (id: string, source: 'body-json' | 'header' | 'status', path: string, targetVariable: string, enabled = true) => ({
  id,
  source,
  path,
  targetVariable,
  enabled,
});

describe('readPipelineStep', () => {
  it('reports time, status text and each value a step captures, typed as code reads it', () => {
    const step = readPipelineStep(
      request({
        captures: [
          capture('c1', 'body-json', 'id', 'deployId'),
          capture('c2', 'header', 'etag', 'etag'),
          capture('c3', 'status', '', 'code'),
          capture('c4', 'body-json', 'missing', 'gone'),
          capture('c5', 'body-json', 'id', 'off', false),
        ],
      }),
      response(),
      new Set()
    );
    expect(step.passed).toBe(true);
    expect(step.report).toEqual({
      durationMs: 412,
      statusText: 'Created',
      captures: [
        { variable: 'deployId', from: 'body.id', value: '"dep_81f2"' },
        { variable: 'etag', from: 'header etag', value: '"W/\\"7\\""' },
        { variable: 'code', from: 'status', value: '201' },
      ],
    });
  });

  it('never carries a value that looks secret: by environment key, by name or by shape', () => {
    // Values shorter than eight characters are flags and counts, as in the stored-data mask.
    expect(readPipelineStep(request({ captures: [capture('c', 'body-json', 'count', 'authCount')] }), response(), new Set(['authCount'])).report.captures).toEqual([
      { variable: 'authCount', from: 'body.count', value: '3' },
    ]);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
    const step = readPipelineStep(
      request({
        captures: [
          capture('c1', 'body-json', 'id', 'deployId'),
          capture('c2', 'body-json', 'token', 'authToken'),
          capture('c3', 'body-json', 'jwt', 'session'),
        ],
      }),
      response({ body: JSON.stringify({ id: 'dep_1234', token: 'fake-token-value', jwt }) }),
      new Set(['deployId'])
    );
    expect(step.report.captures).toEqual([
      { variable: 'deployId', from: 'body.id' },
      { variable: 'authToken', from: 'body.token' },
      { variable: 'session', from: 'body.jwt' },
    ]);
  });

  it('reads out the first failing check with what the response gave, and counts the rest', () => {
    const step = readPipelineStep(
      request({
        assertions: [
          { id: 'a1', source: 'status', path: '', comparator: 'equals', expected: '201', enabled: true },
          { id: 'a2', source: 'body-json', path: 'items[0].status', comparator: 'equals', expected: 'healthy', enabled: true },
          { id: 'a3', source: 'body-json', path: 'count', comparator: 'equals', expected: '9', enabled: true },
          { id: 'a4', source: 'status', path: '', comparator: 'equals', expected: '500', enabled: false },
        ],
      }),
      response(),
      new Set()
    );
    expect(step.passed).toBe(false);
    expect(step.assertionFailures).toBe(2);
    expect(step.report.check).toEqual({ expression: 'body.items[0].status == "healthy"', pass: false, received: '"degraded"', count: 3 });
  });

  it('masks the received value when it is a token the same step captures', () => {
    const step = readPipelineStep(
      request({
        captures: [capture('c', 'body-json', 'token', 'accessToken')],
        assertions: [{ id: 'a', source: 'body-json', path: 'token', comparator: 'equals', expected: 'x', enabled: true }],
      }),
      response({ body: JSON.stringify({ token: 'fake-token-for-tests' }) }),
      new Set()
    );
    expect(step.report.check?.received).toBe('••••••');
    const inside = readPipelineStep(
      request({
        captures: [capture('c', 'body-json', 'auth.token', 'accessToken')],
        assertions: [{ id: 'a', source: 'body-json', path: 'auth', comparator: 'not-exists', expected: '', enabled: true }],
      }),
      response({ body: JSON.stringify({ auth: { token: 'fake-token-for-tests' } }) }),
      new Set()
    );
    expect(inside.report.check?.received).toBe('••••••');
    expect(step.report.captures).toEqual([{ variable: 'accessToken', from: 'body.token' }]);
  });

  it('reads out the first check when every check passes, and leaves out a value the response lacked', () => {
    const passing = readPipelineStep(
      request({ assertions: [{ id: 'a', source: 'body-json', path: 'count', comparator: 'equals', expected: '3', enabled: true }] }),
      response(),
      new Set()
    );
    expect(passing.report.check).toEqual({ expression: 'body.count == 3', pass: true, received: '3', count: 1 });
    const missing = readPipelineStep(
      request({ assertions: [{ id: 'a', source: 'body-json', path: 'nope', comparator: 'exists', expected: '', enabled: true }] }),
      response(),
      new Set()
    );
    expect(missing.report.check).toEqual({ expression: 'body.nope exists', pass: false, count: 1 });
  });

  it('fails on a transport error or a changed snapshot, and captures nothing from a failed response', () => {
    const errored = readPipelineStep(
      request({ captures: [capture('c', 'status', '', 'code')] }),
      response({ kind: 'server-error', status: 500, statusText: 'Internal Server Error' }),
      new Set()
    );
    expect(errored.passed).toBe(false);
    expect(errored.report.captures).toEqual([]);
    const snapshot = { version: 1 as const, status: 201, body: '{"id":"other"}', recordedAt: '2026-11-20T10:00:00.000Z', scrubbers: { timestamps: false, uuids: false, ids: false, hostname: false, regex: '' } };
    const changed = readPipelineStep(request({ snapshot }), response(), new Set());
    expect(changed.passed).toBe(false);
    expect(changed.report.snapshotChanged).toBe(true);
  });
});

describe('summarizePipelineRun', () => {
  const pipeline: HttpPipelineV1 = {
    version: 1,
    id: 'p',
    name: 'deploy',
    steps: [
      { id: 's1', requestId: 'r1', enabled: true },
      { id: 'off', requestId: 'r1', enabled: false },
      { id: 's2', requestId: 'r1', enabled: true },
      { id: 's3', requestId: 'r1', enabled: true },
    ],
    stopOnFailure: true,
    createdAt: '',
    updatedAt: '',
  };
  const report = (durationMs: number) => ({ durationMs, statusText: 'OK', captures: [] });

  it('counts passes over the steps the run covered and names the pipeline position that stopped it', () => {
    const run: HttpPipelineRunSnapshot = {
      pipelineId: 'p',
      startedAt: '',
      phase: 'failed',
      results: [
        { stepId: 's1', requestId: 'r1', status: 'passed', report: report(400) },
        { stepId: 's2', requestId: 'r1', status: 'failed', report: report(150) },
        { stepId: 's3', requestId: 'r1', status: 'skipped', message: 'stopped-on-failure' },
      ],
    };
    expect(summarizePipelineRun(pipeline, run)).toEqual({
      passed: 1,
      total: 3,
      totalMs: 550,
      maxMs: 400,
      halt: { key: 'stoppedAt', index: 3 },
      segments: [
        { key: 's1', ms: 400, failed: false },
        { key: 's2', ms: 150, failed: true },
      ],
    });
  });

  it('counts the enabled steps while running and names the running and cancelled positions', () => {
    const running = summarizePipelineRun(pipeline, { pipelineId: 'p', startedAt: '', phase: 'running', activeStepId: 's2', results: [] });
    expect(running).toMatchObject({ total: 3, halt: { key: 'runningStep', index: 3 }, totalMs: 0, segments: [] });
    const cancelled = summarizePipelineRun(pipeline, {
      pipelineId: 'p',
      startedAt: '',
      phase: 'cancelled',
      results: [
        { stepId: 's1', requestId: 'r1', status: 'passed', report: report(10) },
        { stepId: 's2', requestId: 'r1', status: 'skipped', message: 'cancelled' },
        { stepId: 's3', requestId: 'r1', status: 'skipped', message: 'cancelled' },
      ],
    });
    expect(cancelled).toMatchObject({ halt: { key: 'cancelledAt', index: 3 }, passed: 1 });
  });
});

describe('pipeline step text', () => {
  it('reads a URL as its path, dropping a scheme and host or a leading base variable', () => {
    expect(shownPath('https://api.example.com/v1/x?q=1')).toBe('/v1/x?q=1');
    expect(shownPath('https://api.example.com')).toBe('/');
    expect(shownPath('{{baseUrl}}/v1/deploys/{{deployId}}')).toBe('/v1/deploys/{{deployId}}');
    expect(shownPath('{{ host }}')).toBe('/');
    expect(shownPath('{{baseUrl}}v1')).toBe('{{baseUrl}}v1');
    expect(shownPath('{{baseUrl}}{{path}}')).toBe('{{baseUrl}}{{path}}');
    expect(shownPath('/relative')).toBe('/relative');
  });

  it('reads the host of a resolved URL, and none while a token is left in it', () => {
    expect(pipelineHost('https://api.staging.acme.dev/v1/deploys')).toBe('api.staging.acme.dev');
    expect(pipelineHost('https://user:pw@hooks.example.com:8443/x')).toBe('hooks.example.com:8443');
    expect(pipelineHost('{{baseUrl}}/x')).toBeNull();
    expect(pipelineHost('https://{{host}}/x')).toBeNull();
    expect(pipelineHost('/relative')).toBeNull();
  });

  it('writes values as literals and cuts long ones', () => {
    expect(literalText('dep')).toBe('"dep"');
    expect(literalText(3)).toBe('3');
    expect(literalText(null)).toBe('null');
    expect(literalText({ a: [1] })).toBe('{"a":[1]}');
    expect(literalText('x'.repeat(300))).toHaveLength(120);
  });
});

import { describe, expect, it } from 'vitest';
import {
  LAST_ANSWER_NUMERAL_MAX,
  LAST_ANSWER_PICTURE_MAX,
  LAST_ANSWER_SUBJECT_MAX,
  answerFromValue,
  barHeights,
  codeLastAnswer,
  httpLastAnswer,
  sanitizeLastAnswer,
  sqlLastAnswer,
  testsLastAnswer,
  withDelta,
  type LastAnswer,
} from '@/utils/lastAnswer';
import type { LineResult } from '@/stores/resultStore';
import type { ExecutionResult } from '@/types/execution';
import type { HttpResponseV1 } from '#src/shared/httpWorkspaceSchema';
import type { ProjectTestCase, ProjectTestRunResult } from '#src/shared/projectTests';
import type { SqlResponseV1 } from '#src/shared/sqlWorkspace';

const RAN_AT = 1_700_000_000_000;

function run(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return { stdout: [], stderr: [], executionTime: 12.4, ...overrides } as ExecutionResult;
}

describe('answerFromValue', () => {
  it('reads a number and the unit printed after it', () => {
    expect(answerFromValue('64')).toEqual({ numeral: '64' });
    expect(answerFromValue('1.24 s')).toEqual({ numeral: '1.24', label: 's' });
  });

  it('turns a numeric array into a range with bar heights', () => {
    expect(answerFromValue('[1, 4, 9, 16, 25, 36, 49, 64]')).toEqual({
      numeral: '1 – 64',
      unit: 'items',
      total: 8,
      picture: { kind: 'bars', values: [2, 6, 14, 25, 39, 56, 77, 100] },
    });
  });

  it('keeps other values as clipped one-line text', () => {
    const answer = answerFromValue(`"${'x'.repeat(60)}"\nnext`);
    expect(answer.numeral).toHaveLength(LAST_ANSWER_NUMERAL_MAX);
    expect(answer.numeral.endsWith('…')).toBe(true);
    expect(answerFromValue('[{"a":1}]')).toEqual({ numeral: '[{"a":1}]' });
  });

  it('masks a printed secret before it is stored', () => {
    expect(answerFromValue('sk-live-51Habcdefghijklmnop')).toEqual({ numeral: '<redacted>' });
    expect(answerFromValue('API_KEY=supersecretvalue123').numeral).toBe('API_KEY=<redacted>');
  });

  it('keeps the integer part of a large fractional bound', () => {
    expect(answerFromValue('[1.5, 123456.7]').numeral).toBe('1.5 – 123457');
  });
});

describe('barHeights', () => {
  it('samples a long series down to the picture cap, keeping both ends', () => {
    const heights = barHeights(Array.from({ length: 500 }, (_, index) => index));
    expect(heights).toHaveLength(LAST_ANSWER_PICTURE_MAX);
    expect(heights[0]).toBe(0);
    expect(heights.at(-1)).toBe(100);
  });

  it('scales a series with negatives from its minimum and a flat zero series to 0', () => {
    expect(barHeights([-10, 0, 10])).toEqual([0, 50, 100]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });
});

describe('codeLastAnswer', () => {
  const value = (line: number, text: string, type: LineResult['type'] = 'autoLog'): LineResult => ({ line, value: text, type });

  it('answers with the value furthest down the file', () => {
    const answer = codeLastAnswer({
      result: run(),
      lineResults: [value(9, '3'), value(2, '1'), value(4, 'printed', 'log')],
      fullOutput: '',
      ranAt: RAN_AT,
    });
    expect(answer).toEqual({ kind: 'code', status: 'ok', numeral: '3', durationMs: 12, ranAt: RAN_AT });
  });

  it('falls back to the last printed row, then the last output line', () => {
    expect(
      codeLastAnswer({ result: run(), lineResults: [value(1, 'hello', 'log')], fullOutput: '', ranAt: RAN_AT }).numeral
    ).toBe('hello');
    expect(codeLastAnswer({ result: run(), lineResults: [], fullOutput: 'a\nb 2\n\n', ranAt: RAN_AT }).numeral).toBe('b 2');
  });

  it('names the error of a failed run instead of a stale value', () => {
    const answer = codeLastAnswer({
      result: run({ error: { message: 'TypeError: x is not a function' } }),
      lineResults: [value(1, '5')],
      fullOutput: '',
      ranAt: RAN_AT,
    });
    expect(answer).toMatchObject({ status: 'error', numeral: '', label: 'TypeError' });
  });

  it('names the error a captured expression threw', () => {
    const answer = codeLastAnswer({
      result: run({ magicResults: [{ line: 1, value: 'ReferenceError: x is not defined', kind: 'autoLog', isError: true }] }),
      lineResults: [value(1, 'ReferenceError: x is not defined', 'error')],
      fullOutput: '',
      ranAt: RAN_AT,
    });
    expect(answer).toMatchObject({ status: 'error', numeral: '', label: 'ReferenceError' });
  });

  it('answers a print with what it printed, as the editor hides the undefined it evaluated to', () => {
    const answer = codeLastAnswer({
      result: run(),
      lineResults: [value(1, '42', 'log'), value(1, 'undefined')],
      fullOutput: '42',
      ranAt: RAN_AT,
    });
    expect(answer.numeral).toBe('42');
  });

  it('reports timeouts and stops by their kind', () => {
    expect(codeLastAnswer({ result: run({ kind: 'timeout' }), lineResults: [], fullOutput: '', ranAt: RAN_AT }).status).toBe('timeout');
    expect(codeLastAnswer({ result: run({ cancelled: true }), lineResults: [], fullOutput: '', ranAt: RAN_AT }).status).toBe('stopped');
  });
});

describe('sqlLastAnswer', () => {
  const response = (overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 => ({
    version: 1,
    status: 'success',
    rows: [
      { id: 1, city: 'Lima', orders: 40 },
      { id: 2, city: 'Quito', orders: 20 },
      { id: 3, city: 'Cali', orders: 10 },
    ],
    columns: [
      { name: 'id', type: 'INTEGER' },
      { name: 'city', type: 'VARCHAR' },
      { name: 'orders', type: 'INTEGER' },
    ] as SqlResponseV1['columns'],
    rowCount: 3,
    durationMs: 38.2,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-11-21T10:00:00.000Z',
    ...overrides,
  });

  it('counts rows and draws the first measurable column that is not a key', () => {
    expect(sqlLastAnswer(response(), 'orders by city', RAN_AT)).toEqual({
      kind: 'sql',
      status: 'ok',
      numeral: '3',
      unit: 'rows',
      subject: 'orders by city',
      picture: { kind: 'bars', values: [100, 50, 25] },
      durationMs: 38,
      ranAt: RAN_AT,
    });
  });

  it('marks a lower-bound count and leaves a failure without a numeral', () => {
    expect(sqlLastAnswer(response({ rowCountIsLowerBound: true }), 'q', RAN_AT).numeral).toBe('≥3');
    expect(sqlLastAnswer(response({ status: 'sql-error', rows: [], errorMessage: 'syntax' }), 'q', RAN_AT)).toMatchObject({
      status: 'error',
      numeral: '',
    });
  });
});

describe('httpLastAnswer', () => {
  it('keeps the status, the path without its query and the phase timings', () => {
    const response = {
      kind: 'success',
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.test/v1/services?token=secret',
      finalUrl: 'https://api.example.test/v1/services?token=secret',
      durationMs: 142.3,
      timing: { dnsMs: 4, connectMs: 10.6, tlsMs: 20, waitingMs: 90, downloadMs: 17, redirects: 0, redirectMs: 0 },
    } as HttpResponseV1;
    expect(httpLastAnswer(response, 'GET', RAN_AT)).toEqual({
      kind: 'http',
      status: 'ok',
      numeral: '200',
      unit: 'status',
      label: 'OK',
      subject: 'GET /v1/services',
      picture: { kind: 'phases', values: [4, 11, 20, 90, 17] },
      durationMs: 142,
      ranAt: RAN_AT,
    });
  });

  it('leaves a network failure without a numeral', () => {
    const response = { kind: 'network-error', status: 0, statusText: '', url: 'not a url', finalUrl: '', durationMs: 3 } as HttpResponseV1;
    expect(httpLastAnswer(response, 'POST', RAN_AT)).toMatchObject({ status: 'error', numeral: '', subject: 'POST not a url' });
  });
});

describe('testsLastAnswer', () => {
  const testCase = (file: string, status: ProjectTestCase['status']): ProjectTestCase => ({ file, path: ['t'], status });
  const result = (cases: ProjectTestCase[], kind: ProjectTestRunResult['kind'] = 'failed'): ProjectTestRunResult => ({
    kind,
    framework: 'vitest',
    command: 'vitest run',
    stdout: '',
    stderr: '',
    exitCode: kind === 'success' ? 0 : 1,
    executionTime: 2100,
    timeoutMs: 60_000,
    cases,
  });

  it('counts failures out of the total and names the first failing file', () => {
    const cases = [
      testCase('a.test.ts', 'passed'),
      testCase('cart.test.ts', 'failed'),
      testCase('b.test.ts', 'skipped'),
    ];
    expect(testsLastAnswer(result(cases), RAN_AT)).toEqual({
      kind: 'tests',
      status: 'error',
      numeral: '1',
      unit: 'failed',
      total: 3,
      subject: 'cart.test.ts',
      picture: { kind: 'cells', values: [0, 1, 2] },
      durationMs: 2100,
      ranAt: RAN_AT,
    });
  });

  it('counts passes when nothing failed and caps the cells', () => {
    const cases = Array.from({ length: 40 }, (_, index) => testCase(`t${index}.test.ts`, 'passed'));
    const answer = testsLastAnswer(result(cases, 'success'), RAN_AT);
    expect(answer).toMatchObject({ status: 'ok', numeral: '40', unit: 'passed', total: 40 });
    expect(answer.picture?.values).toHaveLength(LAST_ANSWER_PICTURE_MAX);
  });

  it('keeps a lone failure visible when the cells are bucketed', () => {
    const cases = Array.from({ length: 500 }, (_, index) => testCase(`t${index}.test.ts`, index === 250 ? 'failed' : 'passed'));
    const values = testsLastAnswer(result(cases), RAN_AT).picture?.values ?? [];
    expect(values).toHaveLength(LAST_ANSWER_PICTURE_MAX);
    expect(values.filter(value => value === 1)).toHaveLength(1);
  });
});

describe('withDelta', () => {
  const answer: LastAnswer = { kind: 'code', status: 'ok', numeral: '1', durationMs: 100, ranAt: RAN_AT };

  it('adds the duration change against the previous answer of the same kind', () => {
    expect(withDelta({ ...answer, durationMs: 80 }, answer).deltaMs).toBe(-20);
    expect(withDelta(answer, undefined)).toBe(answer);
    expect(withDelta(answer, { ...answer, kind: 'sql' })).toBe(answer);
  });
});

describe('sanitizeLastAnswer', () => {
  it('keeps a valid answer unchanged', () => {
    const answer: LastAnswer = {
      kind: 'http',
      status: 'ok',
      numeral: '200',
      unit: 'status',
      label: 'OK',
      subject: 'GET /v1',
      picture: { kind: 'phases', values: [1, 2, 3, 4, 5] },
      durationMs: 142,
      deltaMs: -3,
      ranAt: RAN_AT,
    };
    expect(sanitizeLastAnswer(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
  });

  it('rejects malformed values and clips oversized fields', () => {
    expect(sanitizeLastAnswer(null)).toBeUndefined();
    expect(sanitizeLastAnswer({ kind: 'shell', status: 'ok', numeral: '1', ranAt: RAN_AT })).toBeUndefined();
    expect(sanitizeLastAnswer({ kind: 'code', status: 'ok', numeral: 1, ranAt: RAN_AT })).toBeUndefined();
    expect(sanitizeLastAnswer({ kind: 'code', status: 'ok', numeral: '1' })).toBeUndefined();

    const clipped = sanitizeLastAnswer({
      kind: 'code',
      status: 'ok',
      numeral: '9'.repeat(200),
      unit: 'parsecs',
      subject: 's'.repeat(500),
      picture: { kind: 'bars', values: Array.from({ length: 1000 }, () => 50) },
      ranAt: RAN_AT,
    });
    expect(clipped?.numeral).toHaveLength(LAST_ANSWER_NUMERAL_MAX);
    expect(clipped?.subject).toHaveLength(LAST_ANSWER_SUBJECT_MAX);
    expect(clipped?.picture?.values).toHaveLength(LAST_ANSWER_PICTURE_MAX);
    expect(clipped).not.toHaveProperty('unit');
    expect(
      sanitizeLastAnswer({ kind: 'code', status: 'ok', numeral: '1', picture: { kind: 'bars', values: [-5, 50, 1e9] }, durationMs: -3, ranAt: RAN_AT })
    ).toEqual({ kind: 'code', status: 'ok', numeral: '1', picture: { kind: 'bars', values: [0, 50, 100] }, ranAt: RAN_AT });
    expect(sanitizeLastAnswer({ kind: 'code', status: 'ok', numeral: '1', picture: { kind: 'bars', values: ['x'] }, ranAt: RAN_AT })).not.toHaveProperty(
      'picture'
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuckDbExecuteOutcome } from '../../../src/renderer/runtime/duckdbClient';

const { executeQuery, getDuckDbEngine } = vi.hoisted(() => ({ executeQuery: vi.fn(), getDuckDbEngine: vi.fn() }));
vi.mock('../../../src/renderer/runtime/duckdbClient', () => ({ executeQuery, getDuckDbEngine }));

import { INSTANT_TIMEOUT_MS, runInstantPreview } from '../../../src/renderer/runtime/sqlInstantPreview';

const outcome = (patch: Partial<DuckDbExecuteOutcome>): DuckDbExecuteOutcome => ({
  status: 'success',
  rows: [],
  columns: [],
  rowCount: 0,
  durationMs: 4,
  tooLarge: false,
  statementCount: 1,
  ...patch,
});
const verdict = (json: unknown) => outcome({ rows: [{ j: JSON.stringify(json) }] });
const ONE_SELECT = { error: false, statements: [{}] };

describe('runInstantPreview', () => {
  beforeEach(() => {
    executeQuery.mockReset();
    getDuckDbEngine.mockReset();
    getDuckDbEngine.mockResolvedValue({});
  });

  it('does not charge a cold engine start to the budget of the check and the sample', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    getDuckDbEngine.mockImplementationOnce(async () => {
      now += 5_000;
      return {};
    });
    executeQuery
      .mockResolvedValueOnce(verdict(ONE_SELECT))
      .mockResolvedValueOnce(outcome({ columns: [{ name: 'x', type: 'BIGINT' }], rows: [{ x: 1 }], durationMs: 7 }));
    const result = await runInstantPreview('SELECT 1 AS x', new AbortController().signal);
    clock.mockRestore();
    expect(result?.kind).toBe('rows');
    expect(executeQuery.mock.calls.map((call) => (call[1] as { timeoutMs: number }).timeoutMs)).toEqual([INSTANT_TIMEOUT_MS, INSTANT_TIMEOUT_MS]);
  });

  it('reports an engine that fails to start, and stops if the edit moved on while it started', async () => {
    getDuckDbEngine.mockRejectedValueOnce(new Error('wasm 503'));
    executeQuery.mockResolvedValueOnce(outcome({ status: 'engine-load-failed', errorMessage: 'wasm 503' }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toEqual({ kind: 'error', message: 'wasm 503' });
    executeQuery.mockClear();
    const controller = new AbortController();
    getDuckDbEngine.mockImplementationOnce(async () => {
      controller.abort();
      return {};
    });
    expect(await runInstantPreview('SELECT 1', controller.signal)).toBeNull();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('runs the SQL after DuckDB parses it as one SELECT, with a short timeout', async () => {
    executeQuery
      .mockResolvedValueOnce(verdict(ONE_SELECT))
      .mockResolvedValueOnce(outcome({ columns: [{ name: 'x', type: 'BIGINT' }], rows: [{ x: 1 }], durationMs: 7 }));
    const signal = new AbortController().signal;
    const result = await runInstantPreview('SELECT 1 AS x', signal);
    expect(result).toEqual({ kind: 'rows', columns: [{ name: 'x', type: 'BIGINT' }], rows: [{ x: 1 }], capped: false, durationMs: 7, statements: [{}] });
    expect(executeQuery.mock.calls[0]![0]).toBe(
      "SELECT json_serialize_sql('SELECT 1 AS x') AS j, (SELECT to_json(list(lower(function_name))) FROM duckdb_functions() WHERE NOT internal) AS user_functions"
    );
    const [checkOptions, sampleOptions] = executeQuery.mock.calls.map((call) => call[1] as { timeoutMs: number; signal: AbortSignal });
    expect(checkOptions).toEqual({ timeoutMs: INSTANT_TIMEOUT_MS, signal });
    expect(executeQuery.mock.calls[1]![0]).toBe('SELECT 1 AS x');
    expect(sampleOptions!.signal).toBe(signal);
    expect(sampleOptions!.timeoutMs).toBeLessThanOrEqual(INSTANT_TIMEOUT_MS);
  });

  it('marks a full sample as capped', async () => {
    executeQuery.mockResolvedValueOnce(verdict(ONE_SELECT)).mockResolvedValueOnce(outcome({ rows: Array.from({ length: 1000 }, () => ({})) }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toMatchObject({ kind: 'rows', capped: true });
  });

  it('never runs what the parser rejects', async () => {
    executeQuery.mockResolvedValueOnce(verdict({ error: true, error_message: 'Only SELECT statements can be serialized to json!' }));
    expect(await runInstantPreview('PIVOT t ON c', new AbortController().signal)).toEqual({ kind: 'rejected' });
    executeQuery.mockResolvedValueOnce(verdict({ error: false, statements: [{}, {}] }));
    expect(await runInstantPreview('SELECT 1; SELECT 2', new AbortController().signal)).toEqual({ kind: 'rejected' });
    expect(executeQuery).toHaveBeenCalledTimes(2);
  });

  it('never runs a call to a function the user defined', async () => {
    const parse = { error: false, statements: [{ node: { select_list: [{ class: 'FUNCTION', function_name: 'my_macro', children: [] }] } }] };
    executeQuery.mockResolvedValueOnce(outcome({ rows: [{ j: JSON.stringify(parse), user_functions: '["my_macro"]' }] }));
    expect(await runInstantPreview('SELECT my_macro()', new AbortController().signal)).toEqual({ kind: 'blocked', reason: 'unlisted' });
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('runs built-ins when the user has functions of other names, or none', async () => {
    const parse = { error: false, statements: [{ node: { select_list: [{ class: 'FUNCTION', function_name: 'lower', children: [] }] } }] };
    for (const user_functions of ['["my_macro"]', null]) {
      executeQuery.mockResolvedValueOnce(outcome({ rows: [{ j: JSON.stringify(parse), user_functions }] })).mockResolvedValueOnce(outcome({}));
      expect(await runInstantPreview('SELECT lower(a)', new AbortController().signal)).toMatchObject({ kind: 'rows' });
    }
  });

  it('keeps the parse from the breakdown when a rebuild would round a constant', async () => {
    const raw = '{"error":false,"statements":[{"node":{"value":9007199254740993}}]}';
    executeQuery.mockResolvedValueOnce(outcome({ rows: [{ j: raw }] })).mockResolvedValueOnce(outcome({}));
    expect(await runInstantPreview('SELECT 9007199254740993', new AbortController().signal)).toMatchObject({ kind: 'rows', statements: [] });
  });

  it('does not run what is too deep to check', async () => {
    let node: object = { class: 'CONSTANT' };
    for (let index = 0; index < 200_000; index += 1) node = { child: node };
    const parse = vi.spyOn(JSON, 'parse').mockReturnValueOnce({ error: false, statements: [node] });
    executeQuery.mockResolvedValueOnce(outcome({ rows: [{ j: '{}' }] }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toEqual({ kind: 'rejected' });
    expect(executeQuery).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });

  it('never runs what the parse shows reads remotely or has side effects', async () => {
    const remote = { error: false, statements: [{ node: { from_table: { type: 'BASE_TABLE', table_name: 's3://b/a.csv' } } }] };
    executeQuery.mockResolvedValueOnce(verdict(remote));
    expect(await runInstantPreview("SELECT * FROM 's3://b/a.csv'", new AbortController().signal)).toEqual({ kind: 'blocked', reason: 'remote' });
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('shares one time budget, so a slow check leaves less for the sample', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(2_000);
    executeQuery.mockResolvedValueOnce(verdict(ONE_SELECT)).mockResolvedValueOnce(outcome({}));
    await runInstantPreview('SELECT 1', new AbortController().signal);
    expect(executeQuery.mock.calls.map((call) => (call[1] as { timeoutMs: number }).timeoutMs)).toEqual([INSTANT_TIMEOUT_MS, INSTANT_TIMEOUT_MS - 2_000]);
    now.mockRestore();
  });

  it('says when DuckDB had not stopped the sample', async () => {
    executeQuery.mockResolvedValueOnce(verdict(ONE_SELECT)).mockResolvedValueOnce(outcome({ status: 'timeout', stillRunning: true }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toEqual({ kind: 'timeout', stuck: true });
  });

  it('says when DuckDB had not stopped the check either', async () => {
    executeQuery.mockResolvedValueOnce(outcome({ status: 'timeout', stillRunning: true }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toEqual({ kind: 'timeout', stuck: true });
  });

  it('reports a check that runs out of time as a timeout', async () => {
    executeQuery.mockResolvedValueOnce(outcome({ status: 'timeout', errorMessage: 'Query exceeded timeout' }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toEqual({ kind: 'timeout' });
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('shows a syntax error without running', async () => {
    executeQuery.mockResolvedValueOnce(verdict({ error: true, error_message: 'Parser Error: syntax error at end of input' }));
    expect(await runInstantPreview('SELECT', new AbortController().signal)).toEqual({ kind: 'error', message: 'Parser Error: syntax error at end of input' });
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout and a run error, and stays quiet once aborted', async () => {
    executeQuery.mockResolvedValueOnce(verdict(ONE_SELECT)).mockResolvedValueOnce(outcome({ status: 'timeout' }));
    expect(await runInstantPreview('SELECT 1', new AbortController().signal)).toEqual({ kind: 'timeout' });
    executeQuery.mockResolvedValueOnce(verdict(ONE_SELECT)).mockResolvedValueOnce(outcome({ status: 'sql-error', errorMessage: 'no table t' }));
    expect(await runInstantPreview('SELECT * FROM t', new AbortController().signal)).toEqual({ kind: 'error', message: 'no table t' });
    const controller = new AbortController();
    executeQuery.mockImplementationOnce(async () => {
      controller.abort();
      return verdict(ONE_SELECT);
    });
    expect(await runInstantPreview('SELECT 1', controller.signal)).toBeNull();
    expect(executeQuery).toHaveBeenCalledTimes(5);
  });
});

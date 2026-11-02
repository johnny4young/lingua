import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuckDbExecuteOutcome } from '../../../src/renderer/runtime/duckdbClient';

const executeQuery = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/runtime/duckdbClient', () => ({ executeQuery }));

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
  beforeEach(() => executeQuery.mockReset());

  it('runs the SQL after DuckDB parses it as one SELECT, with a short timeout', async () => {
    executeQuery
      .mockResolvedValueOnce(verdict(ONE_SELECT))
      .mockResolvedValueOnce(outcome({ columns: [{ name: 'x', type: 'BIGINT' }], rows: [{ x: 1 }], durationMs: 7 }));
    const signal = new AbortController().signal;
    const result = await runInstantPreview('SELECT 1 AS x', signal);
    expect(result).toEqual({ kind: 'rows', columns: [{ name: 'x', type: 'BIGINT' }], rows: [{ x: 1 }], capped: false, durationMs: 7 });
    expect(executeQuery.mock.calls[0]![0]).toBe("SELECT json_serialize_sql('SELECT 1 AS x') AS j");
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

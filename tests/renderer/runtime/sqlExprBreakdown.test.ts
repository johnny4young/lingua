import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuckDbExecuteOutcome } from '../../../src/renderer/runtime/duckdbClient';

const executeQuery = vi.hoisted(() => vi.fn());
const runInstantPreview = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/runtime/duckdbClient', () => ({ executeQuery, getDuckDbEngine: async () => ({}) }));
vi.mock('../../../src/renderer/runtime/sqlInstantPreview', () => ({ INSTANT_TIMEOUT_MS: 3000, runInstantPreview }));

import { runExprBreakdown } from '../../../src/renderer/runtime/sqlExprBreakdown';

const outcome = (patch: Partial<DuckDbExecuteOutcome>): DuckDbExecuteOutcome => ({
  status: 'success',
  rows: [],
  columns: [],
  rowCount: 0,
  durationMs: 1,
  tooLarge: false,
  statementCount: 1,
  ...patch,
});
const column = (name: string) => ({ class: 'COLUMN_REF', alias: '', column_names: [name] });
const TICKET = { class: 'FUNCTION', alias: 'ticket', function_name: '/', is_operator: true, children: [column('revenue'), column('orders')] };
const SOURCE = { type: 'SELECT_NODE', select_list: [TICKET], modifiers: [], group_expressions: [], aggregate_handling: 'STANDARD_HANDLING' };
const REBUILT = { inner_sql: 'SELECT inner', label_0: 'SELECT (revenue / orders)', label_1: 'SELECT revenue', label_2: 'SELECT orders' };
const run = () => runExprBreakdown(SOURCE, TICKET, 'ticket', new AbortController().signal);

describe('runExprBreakdown', () => {
  beforeEach(() => {
    executeQuery.mockReset();
    runInstantPreview.mockReset();
  });

  it('counts each node through the preview gate', async () => {
    executeQuery.mockResolvedValueOnce(outcome({ rows: [REBUILT] }));
    runInstantPreview.mockResolvedValueOnce({ kind: 'rows', rows: [{ total: '4', nulls_0: '1', nulls_1: '0', nulls_2: 1, zeros_2: 2n }] });
    const result = await run();
    expect(runInstantPreview.mock.calls[0]![0]).toContain('SELECT inner');
    expect(result).toMatchObject({
      kind: 'ready',
      breakdown: {
        column: 'ticket',
        total: 4,
        nodes: [
          { label: 'revenue / orders', depth: 0, nulls: 1 },
          { label: 'revenue', depth: 1, nulls: 0 },
          { label: 'orders', depth: 1, nulls: 1, zeros: { rows: 2, of: 'ticket', gives: 'not-finite' } },
        ],
      },
    });
    if (result?.kind === 'ready') expect(result.breakdown.rowsSql(2)).toContain('WHERE lingua_e2 IS NULL OR TRY_CAST');
  });

  it('names the division a nested divisor belongs to, and the column for the whole one', async () => {
    const nested = { class: 'OPERATOR', alias: 'w', children: [{ class: 'FUNCTION', alias: '', function_name: '//', is_operator: true, children: [column('a'), column('b')] }] };
    executeQuery.mockResolvedValueOnce(outcome({ rows: [{ inner_sql: 'SELECT inner', label_0: 'SELECT COALESCE(a // b)', label_1: 'SELECT (a // b)', label_2: 'SELECT a', label_3: 'SELECT b' }] }));
    runInstantPreview.mockResolvedValueOnce({ kind: 'rows', rows: [{ total: 3, zeros_3: 3 }] });
    const result = await runExprBreakdown(SOURCE, nested, 'w', new AbortController().signal);
    expect(result).toMatchObject({ breakdown: { nodes: [{}, {}, {}, { zeros: { rows: 3, of: 'a // b', gives: 'null' } }] } });
  });

  it('keeps stuck from a rebuild DuckDB did not stop', async () => {
    executeQuery.mockResolvedValueOnce(outcome({ status: 'timeout', stillRunning: true }));
    expect(await run()).toEqual({ kind: 'timeout', stuck: true });
  });

  it('passes on whatever the gate says about the counts', async () => {
    for (const verdict of [{ kind: 'blocked', reason: 'remote' }, { kind: 'rejected' }, { kind: 'timeout' }, null]) {
      executeQuery.mockResolvedValueOnce(outcome({ rows: [REBUILT] }));
      runInstantPreview.mockResolvedValueOnce(verdict);
      expect(await run()).toEqual(verdict);
    }
  });

  it('falls back to the column alone when a part cannot run', async () => {
    executeQuery.mockResolvedValue(outcome({ rows: [REBUILT] }));
    runInstantPreview.mockResolvedValueOnce({ kind: 'error', message: 'Binder Error: revenue must appear in the GROUP BY clause' });
    runInstantPreview.mockResolvedValueOnce({ kind: 'rows', rows: [{ total: 4, nulls_0: 1 }] });
    const result = await run();
    expect(runInstantPreview).toHaveBeenCalledTimes(2);
    expect(runInstantPreview.mock.calls[1]![0]).not.toContain('nulls_1');
    expect(result).toMatchObject({ kind: 'ready', breakdown: { nodes: [{ label: 'revenue / orders', nulls: 1 }] } });
    if (result?.kind === 'ready') expect(result.breakdown.nodes).toHaveLength(1);
  });

  it('reports the error when the column alone cannot run either, and does not retry a timeout', async () => {
    executeQuery.mockResolvedValue(outcome({ rows: [REBUILT] }));
    runInstantPreview.mockResolvedValue({ kind: 'error', message: 'still broken' });
    expect(await run()).toEqual({ kind: 'error', message: 'still broken' });
    expect(runInstantPreview).toHaveBeenCalledTimes(2);
    runInstantPreview.mockReset();
    runInstantPreview.mockResolvedValue({ kind: 'timeout', stuck: true });
    expect(await run()).toEqual({ kind: 'timeout', stuck: true });
    expect(runInstantPreview).toHaveBeenCalledTimes(1);
  });

  it('does not retry a column that is already alone', async () => {
    const aggregate = { class: 'FUNCTION', alias: 'total', function_name: 'sum', is_operator: false, children: [column('n')] };
    executeQuery.mockResolvedValue(outcome({ rows: [{ inner_sql: 'SELECT inner', label_0: 'SELECT sum(n)' }] }));
    runInstantPreview.mockResolvedValue({ kind: 'error', message: 'no table' });
    expect(await runExprBreakdown(SOURCE, aggregate, 'total', new AbortController().signal)).toEqual({ kind: 'error', message: 'no table' });
    expect(runInstantPreview).toHaveBeenCalledTimes(1);
  });

  it('never counts when the rebuild fails, times out or was cancelled', async () => {
    executeQuery.mockResolvedValue(outcome({ status: 'sql-error', errorMessage: 'bad parse' }));
    expect(await run()).toEqual({ kind: 'error', message: 'bad parse' });
    executeQuery.mockReset();
    executeQuery.mockResolvedValueOnce(outcome({ status: 'timeout' }));
    expect(await run()).toEqual({ kind: 'timeout' });
    executeQuery.mockResolvedValueOnce(outcome({ status: 'cancelled' }));
    expect(await run()).toBeNull();
    executeQuery.mockResolvedValue(outcome({ rows: [{}] }));
    expect(await run()).toMatchObject({ kind: 'error' });
    expect(runInstantPreview).not.toHaveBeenCalled();
  });

  it('stays quiet once aborted', async () => {
    const controller = new AbortController();
    executeQuery.mockImplementationOnce(async () => {
      controller.abort();
      return outcome({ rows: [REBUILT] });
    });
    expect(await runExprBreakdown(SOURCE, TICKET, 'ticket', controller.signal)).toBeNull();
    expect(runInstantPreview).not.toHaveBeenCalled();
  });
});

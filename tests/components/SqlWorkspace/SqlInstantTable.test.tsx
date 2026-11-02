import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { SqlInstantTable, type InstantShown } from '../../../src/renderer/components/SqlWorkspace/SqlInstantTable';

const runExprBreakdown = vi.hoisted(() => vi.fn());
const runInstantPreview = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/runtime/sqlExprBreakdown', () => ({ runExprBreakdown }));
vi.mock('../../../src/renderer/runtime/sqlInstantPreview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstantPreview,
}));

const column = (name: string) => ({ class: 'COLUMN_REF', alias: '', column_names: [name] });
const TICKET = { class: 'FUNCTION', alias: 'ticket', function_name: '/', is_operator: true, children: [column('revenue'), column('orders')] };
const inner = { type: 'SELECT_NODE', select_list: [column('city'), TICKET], modifiers: [], group_expressions: [], aggregate_handling: 'STANDARD_HANDLING' };
const makeShown = (): InstantShown => ({
  kind: 'rows',
  columns: [{ name: 'city', type: 'Utf8' }, { name: 'ticket', type: 'Float64' }],
  rows: [{ city: 'Bogota', ticket: 2 }, { city: 'Cali', ticket: null }],
  capped: false,
  durationMs: 1,
  statements: [{ node: { type: 'SELECT_NODE', from_table: { type: 'SUBQUERY', subquery: { node: inner } } } }],
});
const breakdown = {
  column: 'ticket',
  total: 1000,
  nodes: [
    { label: 'revenue / orders', depth: 0, nulls: 1 },
    { label: 'revenue', depth: 1, nulls: 0 },
    { label: 'orders', depth: 1, nulls: 1, zeros: { rows: 1, gives: 'infinity' } },
  ],
  rowsSql: (index: number) => `rows ${index}`,
};
const openBreakdown = async () => {
  fireEvent.click(screen.getByTestId('sql-instant-column-breakdown'));
  await screen.findAllByTestId('sql-instant-breakdown-node');
};

describe('SqlInstantTable', () => {
  beforeEach(async () => {
    await initI18n('en');
    runExprBreakdown.mockReset();
    runInstantPreview.mockReset();
    runExprBreakdown.mockResolvedValue({ kind: 'ready', breakdown });
    runInstantPreview.mockResolvedValue({ kind: 'rows', rows: [{ city: 'Cali', ticket: null }] });
  });

  it('makes only computed columns open a breakdown, and runs nothing until asked', () => {
    render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    expect(screen.getAllByTestId('sql-instant-column-breakdown').map((button) => button.textContent)).toEqual(['ticket']);
    expect(runExprBreakdown).not.toHaveBeenCalled();
    expect(screen.getByTestId('sql-instant-table').textContent).toContain('ticket DOUBLE');
  });

  it('shows no buttons for a parse it cannot use', () => {
    render(<SqlInstantTable shown={{ ...makeShown(), statements: [] }} dimmed={false} busy={false} />);
    expect(screen.queryByTestId('sql-instant-column-breakdown')).toBeNull();
  });

  it('shows each node with its NULL share, a rare share as under 1%, and a divisor zero', async () => {
    render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    await openBreakdown();
    expect(screen.getByTestId('sql-instant-column-breakdown').getAttribute('aria-expanded')).toBe('true');
    const nodes = screen.getAllByTestId('sql-instant-breakdown-node');
    expect(nodes[0]!.textContent).toBe('revenue / orders<1% null');
    expect(nodes[1]!.textContent).toBe('revenue0% null');
    expect((nodes[1] as HTMLButtonElement).disabled).toBe(true);
    expect(nodes[2]!.textContent).toBe('orders<1% null1 row = 0 → ticket ∞');
    expect(nodes[2]!.style.paddingLeft).toBe('14px');
  });

  it('narrows the table to a node and back', async () => {
    render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    await openBreakdown();
    fireEvent.click(screen.getAllByTestId('sql-instant-breakdown-node')[2]!);
    await waitFor(() => expect(screen.getByTestId('sql-instant-table').querySelectorAll('tbody tr')).toHaveLength(1));
    expect(runInstantPreview.mock.calls[0]![0]).toBe('rows 2');
    expect(screen.getByTestId('sql-instant-narrowed').textContent).toContain('Rows where orders is NULL or 0');
    expect(screen.getAllByTestId('sql-instant-breakdown-node')[2]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('sql-instant-narrowed-clear'));
    expect(screen.getByTestId('sql-instant-table').querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.queryByTestId('sql-instant-narrowed')).toBeNull();
  });

  it('says NULL only for a node that is not a divisor, and a second click clears it', async () => {
    render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    await openBreakdown();
    fireEvent.click(screen.getAllByTestId('sql-instant-breakdown-node')[0]!);
    await waitFor(() => expect(screen.getByTestId('sql-instant-narrowed').textContent).toContain('Rows where revenue / orders is NULL'));
    expect(screen.getByTestId('sql-instant-narrowed').textContent).not.toContain('or 0');
    fireEvent.click(screen.getAllByTestId('sql-instant-breakdown-node')[0]!);
    expect(screen.queryByTestId('sql-instant-narrowed')).toBeNull();
  });

  it('refreshes for a new sample, keeps the column open and drops the narrowing', async () => {
    const { rerender } = render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    await openBreakdown();
    fireEvent.click(screen.getAllByTestId('sql-instant-breakdown-node')[2]!);
    await screen.findByTestId('sql-instant-narrowed');
    rerender(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    expect(screen.queryByTestId('sql-instant-narrowed')).toBeNull();
    await waitFor(() => expect(runExprBreakdown).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('sql-instant-breakdown')).toBeTruthy();
  });

  it('waits for a Run and cancels what is running', async () => {
    let signal: AbortSignal | undefined;
    runExprBreakdown.mockImplementation((_source, _expr, _column, abort: AbortSignal) => {
      signal = abort;
      return new Promise(() => {});
    });
    const shown = makeShown();
    const { rerender } = render(<SqlInstantTable shown={shown} dimmed={false} busy={false} />);
    fireEvent.click(screen.getByTestId('sql-instant-column-breakdown'));
    expect(runExprBreakdown).toHaveBeenCalledTimes(1);
    rerender(<SqlInstantTable shown={shown} dimmed={false} busy />);
    expect(signal?.aborted).toBe(true);
    runExprBreakdown.mockClear();
    fireEvent.click(screen.getByTestId('sql-instant-column-breakdown'));
    fireEvent.click(screen.getByTestId('sql-instant-column-breakdown'));
    expect(runExprBreakdown).not.toHaveBeenCalled();
  });

  it('holds the narrowing back until a Run ends', async () => {
    const shown = makeShown();
    const { rerender } = render(<SqlInstantTable shown={shown} dimmed={false} busy={false} />);
    await openBreakdown();
    rerender(<SqlInstantTable shown={shown} dimmed={false} busy />);
    fireEvent.click(screen.getAllByTestId('sql-instant-breakdown-node')[2]!);
    expect(runInstantPreview).not.toHaveBeenCalled();
    rerender(<SqlInstantTable shown={shown} dimmed={false} busy={false} />);
    await waitFor(() => expect(runInstantPreview).toHaveBeenCalledTimes(1));
  });

  it.each([
    [{ kind: 'error', message: 'Binder Error' }, 'Binder Error'],
    [{ kind: 'timeout' }, 'The preview stopped after 3 s. Run the statement to see it.'],
    [{ kind: 'blocked', reason: 'remote' }, 'Remote reads never auto-run'],
    [{ kind: 'rejected' }, 'Only a single SELECT previews'],
  ])('reports %j instead of a tree', async (result, text) => {
    runExprBreakdown.mockResolvedValue(result);
    render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    fireEvent.click(screen.getByTestId('sql-instant-column-breakdown'));
    expect((await screen.findByTestId('sql-instant-breakdown-error')).textContent).toBe(text);
    expect(screen.queryByTestId('sql-instant-breakdown-node')).toBeNull();
  });

  it('keeps the sample and says so when the rows cannot be read', async () => {
    runInstantPreview.mockResolvedValue({ kind: 'timeout' });
    render(<SqlInstantTable shown={makeShown()} dimmed={false} busy={false} />);
    await openBreakdown();
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('sql-instant-breakdown-node')[0]!);
    });
    expect((await screen.findByTestId('sql-instant-narrowed-error')).textContent).toBe('These rows could not be read in time.');
    expect(screen.getByTestId('sql-instant-table').querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('dims the rows while they are stale', () => {
    render(<SqlInstantTable shown={makeShown()} dimmed busy={false} />);
    expect(screen.getByTestId('sql-instant-table').parentElement!.className).toContain('opacity-60');
  });
});

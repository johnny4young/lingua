import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { INSTANT_DEBOUNCE_MS, SqlInstantPreview } from '../../../src/renderer/components/SqlWorkspace/SqlInstantPreview';
import { createInstantSqlChannel, type InstantSqlChannel } from '../../../src/renderer/components/SqlWorkspace/instantSqlChannel';
import { planInstantPreview } from '../../../src/shared/sqlCtePreview';
import type { InstantPreviewResult } from '../../../src/renderer/runtime/sqlInstantPreview';

const runInstantPreview = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/runtime/sqlInstantPreview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runInstantPreview,
}));

const SQL = 'WITH a AS (SELECT 1 AS x), b AS (SELECT x FROM a) SELECT * FROM b';
const rows = (value: number): InstantPreviewResult => ({
  kind: 'rows',
  columns: [{ name: 'x', type: 'INTEGER' }],
  rows: [{ x: value }],
  capped: false,
  durationMs: 4,
});

function publish(channel: InstantSqlChannel, text: string, offset: number, queryId = 'q1') {
  act(() => channel.publish({ queryId, text, plan: planInstantPreview(text, offset) }));
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(INSTANT_DEBOUNCE_MS);
  });
}

describe('SqlInstantPreview', () => {
  let channel: InstantSqlChannel;
  beforeEach(async () => {
    await initI18n('en');
    vi.useFakeTimers();
    runInstantPreview.mockReset();
    runInstantPreview.mockResolvedValue(rows(1));
    channel = createInstantSqlChannel();
  });
  afterEach(() => vi.useRealTimers());

  it('runs once the typing settles and cancels the stale preview', async () => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, 'SELECT 1', 8);
    act(() => vi.advanceTimersByTime(INSTANT_DEBOUNCE_MS - 1));
    publish(channel, 'SELECT 12', 9);
    await settle();
    expect(runInstantPreview).toHaveBeenCalledTimes(1);
    expect(runInstantPreview.mock.calls[0]![0]).toContain('SELECT 12');
    expect(screen.getByTestId('sql-instant-table').textContent).toContain('x INTEGER');
    expect(screen.getByTestId('sql-instant-meta').textContent).toBe('1 row · 4 ms · sample');

    runInstantPreview.mockImplementationOnce(() => new Promise(() => {}));
    publish(channel, 'SELECT 123', 10);
    await settle();
    const signal = runInstantPreview.mock.calls[1]![1] as AbortSignal;
    publish(channel, 'SELECT 1234', 11);
    expect(signal.aborted).toBe(true);
  });

  it('shows the CTE under the cursor and marks what reads it', async () => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, SQL, SQL.indexOf('1 AS x'));
    await settle();
    expect(screen.getByTestId('sql-instant-target').textContent).toBe('CTE · a');
    const crumbs = screen.getAllByTestId('sql-instant-crumb');
    expect(crumbs.map((crumb) => [crumb.textContent, crumb.getAttribute('aria-pressed'), crumb.hasAttribute('data-dependent')])).toEqual([
      ['a', 'true', false],
      ['bReads a, refreshes with it', 'false', true],
      ['resultReads a, refreshes with it', 'false', true],
    ]);
    const jump = vi.spyOn(channel, 'jumpTo');
    fireEvent.click(crumbs[1]!);
    expect(jump).toHaveBeenCalledWith(SQL.indexOf('b AS'));
  });

  it('waits for a Run in flight and hides once the draft ran', async () => {
    const { rerender } = render(<SqlInstantPreview channel={channel} queryId="q1" busy />);
    publish(channel, 'SELECT 1', 8);
    await settle();
    expect(runInstantPreview).not.toHaveBeenCalled();
    rerender(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    await settle();
    expect(runInstantPreview).toHaveBeenCalledTimes(1);
    act(() => channel.markRun());
    expect(screen.queryByTestId('sql-instant-preview')).toBeNull();
    publish(channel, 'SELECT 2', 8);
    expect(screen.getByTestId('sql-instant-preview')).toBeTruthy();
  });

  it('comes back after a Run when the cursor moves to another part', () => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, SQL, SQL.indexOf('1 AS x'));
    act(() => channel.markRun());
    publish(channel, SQL, SQL.indexOf('AS x') + 1);
    expect(screen.queryByTestId('sql-instant-preview')).toBeNull();
    publish(channel, SQL, SQL.indexOf('x FROM a'));
    expect(screen.getByTestId('sql-instant-preview')).toBeTruthy();
  });

  it('ignores a draft from another query', async () => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, 'SELECT 1', 8, 'q2');
    await settle();
    expect(screen.queryByTestId('sql-instant-preview')).toBeNull();
    expect(runInstantPreview).not.toHaveBeenCalled();
  });

  it.each([
    ['DELETE FROM t', 'DML / DDL never auto-run'],
    ["SELECT nextval('s')", 'Side-effect functions never auto-run'],
  ])('never runs %j', async (sql, badge) => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, sql, 0);
    await settle();
    expect(runInstantPreview).not.toHaveBeenCalled();
    expect(screen.getByTestId('sql-instant-preview').textContent).toContain(badge);
  });

  it('says what the parse blocked and hides the last sample', async () => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, 'SELECT 1', 8);
    await settle();
    runInstantPreview.mockResolvedValueOnce({ kind: 'blocked', reason: 'computed-path' });
    publish(channel, "SELECT * FROM read_csv('a' || '.csv')", 8);
    await settle();
    expect(screen.getByTestId('sql-instant-preview').textContent).toContain('Computed file paths never auto-run');
    expect(screen.queryByTestId('sql-instant-table')).toBeNull();
  });

  it('says when DuckDB will not preview it', async () => {
    runInstantPreview.mockResolvedValue({ kind: 'rejected' });
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, 'SELECT 1', 8);
    await settle();
    expect(screen.getByTestId('sql-instant-preview').textContent).toContain('Only a single SELECT previews');
  });

  it('keeps the last sample, dimmed, under an error or a timeout', async () => {
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, 'SELECT 1', 8);
    await settle();
    runInstantPreview.mockResolvedValueOnce({ kind: 'error', message: 'Parser Error: oops' });
    publish(channel, 'SELECT 1 +', 10);
    await settle();
    expect(screen.getByTestId('sql-instant-error').textContent).toBe('Parser Error: oops');
    expect(screen.getByTestId('sql-instant-table').parentElement!.className).toContain('opacity-60');
    runInstantPreview.mockResolvedValueOnce({ kind: 'timeout' });
    publish(channel, 'SELECT 1 + 2', 12);
    await settle();
    expect(screen.getByTestId('sql-instant-error').textContent).toBe('The preview stopped after 3 s. Run the statement to see it.');
    expect(screen.getByTestId('sql-instant-table').textContent).toContain('1');
  });

  it('renders the first 100 rows of a capped sample', async () => {
    runInstantPreview.mockResolvedValue({ ...rows(0), rows: Array.from({ length: 1000 }, (_, x) => ({ x })), capped: true });
    render(<SqlInstantPreview channel={channel} queryId="q1" busy={false} />);
    publish(channel, 'SELECT 1', 8);
    await settle();
    expect(screen.getByTestId('sql-instant-table').querySelectorAll('tbody tr')).toHaveLength(100);
    expect(screen.getByTestId('sql-instant-meta').textContent).toBe('1,000+ rows · 4 ms · sample');
    expect(screen.getByTestId('sql-instant-preview').textContent).toContain('900 more rows in the sample');
  });
});

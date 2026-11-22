import { render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SqlHistorySection } from '../../../src/renderer/components/SqlWorkspace/SqlHistorySection';
import { lastDurationByQuery, latencyShare } from '../../../src/renderer/components/SqlWorkspace/sqlLatency';
import { SqlQueryList } from '../../../src/renderer/components/SqlWorkspace/SqlQueryList';
import type { SqlHistoryEntryV1 } from '../../../src/shared/sqlHistory';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';

const entry = (id: string, queryId: string, durationMs: number, status: SqlHistoryEntryV1['status'] = 'success'): SqlHistoryEntryV1 => ({
  version: 1,
  id,
  queryId,
  sql: `SELECT ${id}`,
  status,
  durationMs,
  rowCount: 1,
  recordedAt: '2026-11-21T10:00:00.000Z',
});

// Newest first, as the store keeps it.
const history = [entry('h3', 'a', 38), entry('h2', 'b', 1_400, 'sql-error'), entry('h1', 'a', 212)];

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

describe('latency bars', () => {
  it('scales by the square root of the slowest run', () => {
    expect(latencyShare(100, 400)).toBe(0.5);
    expect(latencyShare(400, 400)).toBe(1);
    expect(latencyShare(5, 0)).toBe(0);
  });

  it('takes the newest run per query', () => {
    expect([...lastDurationByQuery(history)]).toEqual([
      ['a', 38],
      ['b', 1_400],
    ]);
  });

  it('draws a bar on every history row, failed runs in the error tone', () => {
    render(<SqlHistorySection entries={history} open onToggle={vi.fn()} onOpenEntry={vi.fn()} onClear={vi.fn()} />);
    const rows = screen.getAllByTestId('sql-history-row');
    expect(rows).toHaveLength(3);
    const bars = rows.map((row) => within(row).getByTestId('sql-latency-bar').firstElementChild as HTMLElement);
    expect(bars[1]!.style.width).toBe('max(0.25rem, 100.0%)');
    expect(bars[1]!.className).toContain('bg-error-fg');
    expect(bars[0]!.className).toContain('bg-fg-muted');
  });

  it('shows the last run on saved rows only', () => {
    const queries = [
      createBlankSqlQuery({ id: 'a', name: 'orders by city', query: 'SELECT 1' }),
      { ...createBlankSqlQuery({ id: 'c', name: 'Scratch 1', query: 'SELECT 2' }), kind: 'scratch' as const },
      createBlankSqlQuery({ id: 'd', name: 'never run', query: 'SELECT 3' }),
    ];
    render(
      <SqlQueryList
        queries={queries}
        activeQueryId="a"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        lastDurations={new Map([...lastDurationByQuery(history), ['c', 5]])}
      />
    );
    const latencies = screen.getAllByTestId('sql-query-list-latency');
    expect(latencies).toHaveLength(1);
    expect(latencies[0]!.textContent).toBe('38 ms');
    expect(latencies[0]!.getAttribute('title')).toBe('Last run: 38 ms');
  });
});

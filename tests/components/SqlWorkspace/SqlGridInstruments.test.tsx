import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import { SqlVirtualGrid } from '../../../src/renderer/components/SqlWorkspace/SqlVirtualGrid';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

function response(): SqlResponseV1 {
  const rows = [
    { id: 1, city: 'Medellín', orders: 5412, revenue: '818294.40', avg_ticket: 151.2 },
    { id: 2, city: 'Bogotá', orders: 4977, revenue: '731121.30', avg_ticket: 146.9 },
    { id: 3, city: 'Cali', orders: 2306, revenue: '301763.16', avg_ticket: 130.86 },
    { id: 4, city: 'Cali', orders: null, revenue: '0.00', avg_ticket: 120 },
  ];
  return {
    version: 1,
    status: 'success',
    rows,
    columns: [
      { name: 'id', type: 'Int32' },
      { name: 'city', type: 'Utf8' },
      { name: 'orders', type: 'Int64' },
      { name: 'revenue', type: 'Decimal(10, 2)' },
      { name: 'avg_ticket', type: 'Float64' },
    ],
    rowCount: rows.length,
    durationMs: 3,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-11-21T10:00:00.000Z',
  };
}

const head = (column: string) => screen.getAllByTestId('sql-result-preview-sort').find((node) => node.dataset.column === column)!;
const cell = (row: number, column: string) =>
  screen.getAllByTestId('sql-result-preview-row')[row]!.querySelector<HTMLElement>(`td[data-column="${column}"]`)!;

beforeEach(async () => {
  await i18next.changeLanguage('en');
});

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('SQL grid instruments', () => {
  it('types each head and shows the distribution, a text column its distinct count', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(within(head('city')).getByTestId('sql-result-preview-type').textContent).toBe('VARCHAR');
    expect(within(head('city')).getByTestId('sql-result-head-meta').textContent).toBe('· 3 distinct');
    expect(within(head('orders')).getByTestId('sql-result-head-spark').children.length).toBeGreaterThan(1);

    fireEvent.click(head('revenue'));
    expect(within(head('revenue')).getByTestId('sql-result-head-meta').textContent).toContain('sorted');
    expect(within(head('revenue')).queryByTestId('sql-result-head-spark')).toBeNull();
  });

  it('draws a bar in numeric cells against each column maximum, never on keys or nulls', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    const fill = (row: number, column: string) =>
      within(cell(row, column)).getByTestId('sql-cell-scale').querySelector<HTMLElement>('[aria-hidden] > span');
    expect(fill(0, 'orders')!.style.width).toBe('max(0.375rem, 100.0%)');
    expect(fill(2, 'orders')!.style.width).toBe('max(0.375rem, 42.6%)');
    expect(fill(0, 'revenue')!.style.width).toBe('max(0.375rem, 100.0%)');
    // A zero keeps its empty track.
    expect(fill(3, 'revenue')).toBeNull();
    expect(cell(3, 'orders').querySelector('[data-testid="sql-cell-scale"]')).toBeNull();
    expect(cell(0, 'id').querySelector('[data-testid="sql-cell-scale"]')).toBeNull();
    expect(cell(0, 'revenue').textContent).toBe('818294.40');
  });

  it('sums and averages the loaded rows in a Σ row', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    const summary = screen.getByTestId('sql-result-summary');
    const at = (column: string) => summary.querySelector<HTMLElement>(`td[data-column="${column}"]`)!;
    // Σ and the count sit under the first column without a sum, here the key.
    expect(at('id').textContent).toBe('ΣProfile of 4 rows');
    expect(at('city').textContent).toBe('');
    expect(at('orders').textContent).toBe('sum12,695');
    expect(at('revenue').textContent).toBe('sum1,851,178.86');
    expect(at('avg_ticket').dataset.summary).toBe('avg');
    expect(at('avg_ticket').textContent).toBe('avg137.24');
    expect(screen.getByTestId('sql-result-preview-table').getAttribute('aria-rowcount')).toBe('6');
  });

  it('keeps the distribution in one place: the rail when it is open', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    fireEvent.click(screen.getByTestId('sql-column-rail-toggle'));
    expect(screen.getByTestId('sql-column-rail')).toBeTruthy();
    expect(screen.queryAllByTestId('sql-result-head-spark')).toHaveLength(0);
    expect(screen.queryAllByTestId('sql-result-head-meta')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('sql-column-rail-toggle'));
    expect(screen.getAllByTestId('sql-result-head-meta').length).toBeGreaterThan(0);
  });

  it('gives the heads the distribution back while the value viewer takes the rail place', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    const toggle = screen.getByTestId('sql-column-rail-toggle');
    if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
    expect(screen.queryAllByTestId('sql-result-head-meta')).toHaveLength(0);
    fireEvent.click(cell(0, 'city'));
    fireEvent.keyDown(screen.getByTestId('sql-result-preview-table-container'), { key: 'Enter' });
    expect(screen.queryByTestId('sql-column-rail')).toBeNull();
    expect(within(head('city')).getByTestId('sql-result-head-meta').textContent).toBe('· 3 distinct');
    fireEvent.click(screen.getByTestId('sql-value-viewer-close'));
    fireEvent.click(screen.getByTestId('sql-column-rail-toggle'));
  });

  it('draws the 0–1 bar only for values in 0–1, even past the sampled rows', () => {
    render(
      <SqlVirtualGrid
        columns={[{ name: 'share', type: 'Float64' }]}
        rows={[{ share: 0.5 }, { share: 37 }]}
        sort={{ column: null, direction: 'asc' }}
        onSort={vi.fn()}
        selected={null}
        onSelect={vi.fn()}
        onCellAction={vi.fn()}
        onCopyRow={vi.fn()}
        instruments={{ fractions: new Set(['share']), scales: new Map(), summaries: new Map(), labelColumn: null, rowCount: 1, skipped: 1 }}
      />
    );
    const rows = screen.getAllByTestId('sql-result-preview-row');
    expect(within(rows[0]!).queryByTestId('sql-cell-bar')).not.toBeNull();
    expect(within(rows[1]!).queryByTestId('sql-cell-bar')).toBeNull();
    expect(rows[1]!.textContent).toBe('37');
  });

  it('localizes the Σ row and the heads in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(within(head('city')).getByTestId('sql-result-head-meta').textContent).toBe('· 3 distintos');
    expect(screen.getByTestId('sql-result-summary-count').textContent).toBe('ΣPerfil de 4 filas');
    expect(screen.getByTestId('sql-result-summary').querySelector('td[data-column="avg_ticket"]')!.textContent).toBe('prom.137,24');
  });
});

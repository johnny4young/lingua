import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import { SqlVirtualGrid } from '../../../src/renderer/components/SqlWorkspace/SqlVirtualGrid';
import { resultInstruments } from '../../../src/renderer/components/SqlWorkspace/sqlColumnInstruments';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

vi.mock('../../../src/renderer/components/SqlWorkspace/sqlColumnInstruments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/renderer/components/SqlWorkspace/sqlColumnInstruments')>();
  return { ...actual, resultInstruments: vi.fn(actual.resultInstruments) };
});

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
  vi.restoreAllMocks();
  await i18next.changeLanguage('en');
});

/** Lays the grid out at a given height under a 46 px header; jsdom measures nothing. */
function layOutGrid(height: number) {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'sql-result-preview-table-container' ? height : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'THEAD' ? 46 : 0;
  });
}

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
    expect(cell(0, 'revenue').textContent).toBe('818,294.40');
  });

  it('groups the digits of numbers on screen but keeps keys raw and copies the raw value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(cell(0, 'orders').textContent).toBe('5,412');
    expect(cell(1, 'avg_ticket').textContent).toBe('146.9');
    expect(cell(0, 'id').textContent).toBe('1');

    fireEvent.contextMenu(cell(0, 'revenue'));
    // The copy-row shortcut lives in the menu now that the footer hint is gone.
    expect(screen.getByTestId('sql-cell-menu-copy-row-keys').textContent).not.toBe('');
    fireEvent.click(screen.getByTestId('sql-cell-menu-copy-value'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('818294.40'));
  });

  it('keeps a barred year column on its raw digits', () => {
    const base = response();
    const rows = [{ year: 2023, orders: 5412 }, { year: 2024, orders: 4977 }];
    render(
      <SqlResultPreview
        response={{ ...base, rows, rowCount: rows.length, columns: [{ name: 'year', type: 'Int32' }, { name: 'orders', type: 'Int64' }] }}
        isExecuting={false}
        rowDisplayLimit={100}
      />
    );
    expect(cell(1, 'year').querySelector('[data-testid="sql-cell-scale"]')).not.toBeNull();
    expect(cell(1, 'year').textContent).toBe('2024');
    expect(cell(0, 'orders').textContent).toBe('5,412');
  });

  it('spans the pane: columns share the width a narrow result leaves', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(screen.getByTestId('sql-result-preview-table').className).toContain('min-w-full');
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

  it('steps the sticky Σ row aside on a grid too short to show a row beside it', () => {
    layOutGrid(78);
    const { unmount } = render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(screen.queryByTestId('sql-result-summary')).toBeNull();
    expect(screen.getByTestId('sql-result-preview-table').getAttribute('aria-rowcount')).toBe('5');
    unmount();
    layOutGrid(102);
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(screen.getByTestId('sql-result-summary')).toBeTruthy();
  });

  it('works the instruments out again for new rows, not for a loading flag', () => {
    const more = { rows: [{ id: 5, city: 'Pasto', orders: 10, revenue: '1.00', avg_ticket: 1 }], canRead: true, loading: false };
    const base = response();
    const { rerender } = render(<SqlResultPreview response={base} isExecuting={false} rowDisplayLimit={100} more={more} />);
    const calls = vi.mocked(resultInstruments).mock.calls.length;
    rerender(<SqlResultPreview response={base} isExecuting={false} rowDisplayLimit={100} more={{ ...more, loading: true }} />);
    expect(vi.mocked(resultInstruments).mock.calls.length).toBe(calls);
    rerender(<SqlResultPreview response={base} isExecuting={false} rowDisplayLimit={100} more={{ ...more, rows: [...more.rows, ...more.rows] }} />);
    expect(vi.mocked(resultInstruments).mock.calls.length).toBeGreaterThan(calls);
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
    expect(cell(0, 'revenue').textContent).toBe('818.294,40');
    expect(cell(0, 'orders').textContent).toBe('5412');
  });
});

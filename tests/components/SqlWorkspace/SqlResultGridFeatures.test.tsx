import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import type { SqlForeignKey } from '../../../src/renderer/runtime/sqlForeignKeys';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

function response(rows: Array<Record<string, unknown>>, overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows,
    columns: [
      { name: 'id', type: 'Int64' },
      { name: 'city', type: 'Utf8' },
      { name: 'meta', type: 'Utf8' },
      { name: 'receipt', type: 'Binary' },
    ],
    rowCount: rows.length,
    durationMs: 4,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-10-21T10:00:00.000Z',
    ...overrides,
  };
}

const rows = Array.from({ length: 2_000 }, (_, i) => ({
  id: String(i),
  city: ['Medellin', 'Cali', null][i % 3],
  meta: '{"channel":"web","n":1}',
  receipt: png,
}));

beforeEach(async () => {
  await i18next.changeLanguage('en');
  useUIStore.setState({ statusNotice: null });
});

describe('virtualized grid', () => {
  it('mounts only a screenful of rows however many are shown', () => {
    render(<SqlResultPreview response={response(rows)} isExecuting={false} rowDisplayLimit={2_000} />);
    const mounted = screen.getAllByTestId('sql-result-preview-row');
    expect(mounted.length).toBeGreaterThan(10);
    expect(mounted.length).toBeLessThan(100);
    expect(screen.getByTestId('sql-result-preview-table').getAttribute('aria-rowcount')).toBe('2001');
  });

  it('pages through loaded rows with Load more and reads the stream past them', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <SqlResultPreview
        response={response(rows.slice(0, 1_500), { rowCountIsLowerBound: true, tooLarge: true, rowCount: 1_500 })}
        isExecuting={false}
        rowDisplayLimit={1_000}
        more={{ rows: [], canRead: true, loading: false }}
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByText(/1,000 of ≥ 1,500 rows in view/)).toBeTruthy();
    await user.click(screen.getByTestId('sql-result-load-more'));
    expect(onLoadMore).toHaveBeenCalledOnce();
    rerender(
      <SqlResultPreview
        response={response(rows.slice(0, 1_500), { rowCountIsLowerBound: true, tooLarge: true, rowCount: 1_500 })}
        isExecuting={false}
        rowDisplayLimit={1_000}
        more={{ rows: rows.slice(1_500), canRead: false, complete: true, loading: false }}
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByText(/^2,000 rows/)).toBeTruthy();
    expect(screen.queryByTestId('sql-result-load-more')).toBeNull();
  });

  it('keeps the total a lower bound when reading stopped at the cap instead of the end', () => {
    render(
      <SqlResultPreview
        response={response(rows.slice(0, 1_500), { rowCountIsLowerBound: true, tooLarge: true, rowCount: 1_500 })}
        isExecuting={false}
        rowDisplayLimit={5_000}
        more={{ rows: rows.slice(1_500), canRead: false, complete: false, loading: false }}
        onLoadMore={vi.fn()}
      />
    );
    expect(screen.queryByText(/^2,000 rows/)).toBeNull();
    expect(screen.getByText(/^2,000 of ≥ 2,000 rows in view/)).toBeTruthy();
  });
});

describe('cell menu and filters', () => {
  it('filters by a cell value and shows the grid as SQL to apply', async () => {
    const user = userEvent.setup();
    const onApplySql = vi.fn();
    render(
      <SqlResultPreview
        response={response(rows.slice(0, 9))}
        isExecuting={false}
        rowDisplayLimit={1_000}
        source={{ origin: 'editor', sql: 'SELECT * FROM orders' }}
        onApplySql={onApplySql}
      />
    );
    const cell = screen.getAllByTestId('sql-result-preview-row')[0]!.querySelector('td[data-column="city"]')!;
    fireEvent.contextMenu(cell);
    await user.click(screen.getByTestId('sql-cell-menu-filter'));
    expect(screen.getAllByTestId('sql-result-preview-row')).toHaveLength(3);
    expect(screen.getByTestId('sql-condition-chip').textContent).toContain('city = Medellin');
    expect(screen.getByTestId('sql-grid-sql').textContent).toContain(`WHERE "city" = 'Medellin'`);
    await user.click(screen.getByTestId('sql-grid-sql-apply'));
    expect(onApplySql).toHaveBeenCalledWith(expect.stringContaining('FROM (\nSELECT * FROM orders\n) AS result'));
  });

  it('adds a condition from the editor and hides a column from the picker', async () => {
    const user = userEvent.setup();
    render(<SqlResultPreview response={response(rows.slice(0, 9))} isExecuting={false} rowDisplayLimit={1_000} />);
    await user.click(screen.getByTestId('sql-condition-new'));
    await user.selectOptions(screen.getByTestId('sql-condition-column'), 'id');
    await user.selectOptions(screen.getByTestId('sql-condition-op'), '>=');
    await user.type(screen.getByTestId('sql-condition-value'), '7');
    await user.click(screen.getByTestId('sql-condition-add'));
    expect(screen.getAllByTestId('sql-result-preview-row')).toHaveLength(2);

    await user.click(screen.getByTestId('sql-columns-chip'));
    await user.click(within(screen.getByTestId('sql-column-picker')).getByRole('checkbox', { name: 'meta' }));
    expect(screen.getByTestId('sql-columns-chip').textContent).toBe('columns 3 / 4');
    expect(screen.queryByText('{"channel":"web","n":1}')).toBeNull();
  });

  it('copies a value and a row as INSERT', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<SqlResultPreview response={response(rows.slice(0, 3))} isExecuting={false} rowDisplayLimit={1_000} />);
    const cell = screen.getAllByTestId('sql-result-preview-row')[1]!.querySelector('td[data-column="city"]')!;
    fireEvent.contextMenu(cell);
    await user.click(screen.getByTestId('sql-cell-menu-copy-value'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('Cali'));
    fireEvent.contextMenu(cell);
    await user.click(screen.getByTestId('sql-cell-menu-copy-insert'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^INSERT INTO "result"/)));
  });
});

describe('value viewer', () => {
  it('opens on Enter with JSON pretty-printed, and shows a BLOB image with hex', async () => {
    const user = userEvent.setup();
    render(<SqlResultPreview response={response(rows.slice(0, 3))} isExecuting={false} rowDisplayLimit={1_000} />);
    const metaCell = screen.getAllByTestId('sql-result-preview-row')[0]!.querySelector('td[data-column="meta"]')!;
    await user.click(metaCell);
    fireEvent.keyDown(screen.getByTestId('sql-result-preview-table-container'), { key: 'Enter' });
    expect(screen.getByTestId('sql-value-json').textContent).toBe('{\n  "channel": "web",\n  "n": 1\n}');
    expect(screen.queryByTestId('sql-column-rail')).toBeNull();

    fireEvent.keyDown(screen.getByTestId('sql-result-preview-table-container'), { key: 'ArrowRight' });
    expect(screen.getByTestId('sql-value-blob').textContent).toContain('PNG · 8 B');
    expect(screen.getByTestId('sql-value-image')).toBeTruthy();
    await user.click(screen.getByTestId('sql-value-hex-toggle'));
    expect(screen.getByTestId('sql-value-hex').textContent).toContain('89 50 4e 47');
    await user.click(screen.getByTestId('sql-value-viewer-close'));
    expect(screen.getByTestId('sql-column-rail')).toBeTruthy();
  });

  it('links foreign-key cells and counts the rows that point at the selected row', async () => {
    const user = userEvent.setup();
    const outgoing: SqlForeignKey = { table: 'orders', schema: 'main', column: 'id', refTable: 'customers', refColumn: 'id' };
    const incoming: SqlForeignKey = { table: 'order_items', schema: 'main', column: 'order_id', refTable: 'orders', refColumn: 'id' };
    const onFollow = vi.fn();
    const onOpenReference = vi.fn();
    const countReferences = vi.fn(async () => 3);
    render(
      <SqlResultPreview
        response={response(rows.slice(0, 3))}
        isExecuting={false}
        rowDisplayLimit={1_000}
        source={{ origin: 'table', sql: 'SELECT * FROM "orders" LIMIT 100;', tableName: 'orders', backTo: 'customers' }}
        onBack={vi.fn()}
        foreignKeys={{ outgoing: [outgoing], incoming: [incoming], onFollow, onOpenReference, countReferences }}
      />
    );
    expect(screen.getByTestId('sql-result-strip-back').textContent).toContain('back to customers');
    await user.click(screen.getAllByTestId('sql-result-fk-link')[1]!);
    expect(onFollow).toHaveBeenCalledWith(outgoing, '1');
    const cell = screen.getAllByTestId('sql-result-preview-row')[2]!.querySelector('td[data-column="city"]')!;
    await user.dblClick(cell);
    expect(await screen.findByText('Referenced by: order_items (3)')).toBeTruthy();
    expect(countReferences).toHaveBeenCalledWith(incoming, '2');
    await user.click(screen.getByTestId('sql-value-referenced-by-chip'));
    expect(onOpenReference).toHaveBeenCalledWith(incoming, '2');
  });
});

describe('column rail', () => {
  it('summarizes the loaded rows and inserts a predicate from a value or a bar', async () => {
    const user = userEvent.setup();
    const onInsertPredicate = vi.fn();
    render(
      <SqlResultPreview response={response(rows.slice(0, 9))} isExecuting={false} rowDisplayLimit={1_000} onInsertPredicate={onInsertPredicate} />
    );
    const rail = screen.getByTestId('sql-column-rail');
    expect(within(rail).getByTestId('sql-column-rail-sample').textContent).toBe('of the 9 rows loaded');
    const city = within(rail).getAllByTestId('sql-rail-column').find((node) => node.dataset.column === 'city')!;
    expect(city.textContent).toContain('33% null');
    await user.click(within(city).getAllByTestId('sql-rail-value')[0]!);
    expect(onInsertPredicate).toHaveBeenCalledWith("city = 'Cali'");
    const id = within(rail).getAllByTestId('sql-rail-column').find((node) => node.dataset.column === 'id')!;
    await user.click(within(id).getAllByTestId('sql-rail-bin')[0]!);
    expect(onInsertPredicate).toHaveBeenLastCalledWith('id BETWEEN 0 AND 1');
    await user.click(screen.getByTestId('sql-column-rail-toggle'));
    expect(screen.queryByTestId('sql-column-rail')).toBeNull();
    await user.click(screen.getByTestId('sql-column-rail-toggle'));
  });
});

import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const COLUMNS = 100;
const ROWS = 100_000;
const columns = Array.from({ length: COLUMNS }, (_, i) => ({ name: `c${i}`, type: i % 2 ? 'Utf8' : 'Int64' }));
const rows = Array.from({ length: ROWS }, (_, r) => {
  const row: Record<string, unknown> = {};
  for (let c = 0; c < COLUMNS; c++) row[`c${c}`] = c % 2 ? `v${r % 97}` : String(r * c);
  return row;
});
const response: SqlResponseV1 = {
  version: 1,
  status: 'success',
  rows,
  columns,
  rowCount: ROWS,
  durationMs: 1,
  tooLarge: false,
  statementCount: 1,
  recordedAt: '2026-10-21T10:00:00.000Z',
};

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

// A test-id lookup reads every attribute of all 5,000 cells, so go by structure: at this size six lookups cost more than the scroll.
const mountedRows = (table: HTMLTableElement) =>
  [...table.tBodies[0]!.rows].filter((row) => row.dataset.testid === 'sql-result-preview-row');

describe('grid at 100,000 rows by 100 columns', () => {
  it('mounts a screenful of rows and columns and moves both windows on scroll', () => {
    const { container: root } = render(<SqlResultPreview response={response} isExecuting={false} rowDisplayLimit={ROWS} />);
    const table = root.querySelector('table')!;
    expect(table.getAttribute('aria-rowcount')).toBe(String(ROWS + 1));
    expect(mountedRows(table).length).toBeLessThan(100);
    // About 53 rows of 12 cells and a gap, where a screen shows perhaps 15 columns.
    expect(table.querySelectorAll('td').length).toBeLessThan(750);
    expect(table.tHead!.rows[0]!.cells.length).toBe(COLUMNS);

    const container = table.parentElement!;
    expect(container.dataset.testid).toBe('sql-result-preview-table-container');
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 520 });
    container.scrollTop = 26 * 60_000;
    fireEvent.scroll(container);
    const mounted = mountedRows(table);
    expect(Number(mounted[0]!.getAttribute('aria-rowindex'))).toBeGreaterThan(59_000);
    expect(mounted.length).toBeLessThan(100);
    expect(table.querySelectorAll('td').length).toBeLessThan(750);

    container.scrollLeft = 165 * 50;
    fireEvent.scroll(container);
    const cells = [...mountedRows(table)[0]!.cells].filter((cell) => cell.dataset.column);
    expect(cells.length).toBeLessThan(20);
    expect(cells[0]!.getAttribute('aria-colindex')).toBe(String(Number(cells[0]!.dataset.column!.slice(1)) + 1));
    expect(cells.map((cell) => cell.dataset.column)).toContain('c50');
    expect(table.querySelectorAll('td').length).toBeLessThan(1_500);
    // The rail summarizes the first rows of a result this wide, and says so.
    expect(root.querySelector('aside [data-testid="sql-column-rail-sample"]')!.textContent).toBe('of the first 10,000 of 100,000 rows loaded');
  });
});

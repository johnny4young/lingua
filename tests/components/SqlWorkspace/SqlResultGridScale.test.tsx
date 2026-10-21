import { fireEvent, render, screen } from '@testing-library/react';
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

describe('grid at 100,000 rows by 100 columns', () => {
  it('mounts a screenful of rows and moves the window on scroll', () => {
    render(<SqlResultPreview response={response} isExecuting={false} rowDisplayLimit={ROWS} />);
    const table = screen.getByTestId('sql-result-preview-table');
    expect(table.getAttribute('aria-rowcount')).toBe(String(ROWS + 1));
    const mounted = screen.getAllByTestId('sql-result-preview-row');
    expect(mounted.length).toBeLessThan(100);
    expect(table.querySelectorAll('td').length).toBeLessThan(100 * (COLUMNS + 2));

    const container = screen.getByTestId('sql-result-preview-table-container');
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 520 });
    container.scrollTop = 26 * 60_000;
    fireEvent.scroll(container);
    const first = screen.getAllByTestId('sql-result-preview-row')[0]!;
    expect(Number(first.getAttribute('aria-rowindex'))).toBeGreaterThan(59_000);
    expect(screen.getAllByTestId('sql-result-preview-row').length).toBeLessThan(100);
    // The rail summarizes the first rows of a result this wide, and says so.
    expect(screen.getByTestId('sql-column-rail-sample').textContent).toBe('of the first 10,000 of 100,000 rows loaded');
  });
});

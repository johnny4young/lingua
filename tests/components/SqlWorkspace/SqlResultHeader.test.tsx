import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

function response(overrides: Partial<SqlResponseV1> = {}): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [
      { city: 'Medellín', orders: 5412 },
      { city: 'Bogotá', orders: 4977 },
    ],
    columns: [
      { name: 'city', type: 'VARCHAR' },
      { name: 'orders', type: 'BIGINT' },
    ],
    rowCount: 2,
    durationMs: 38,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-11-11T14:02:00.000Z',
    ...overrides,
  };
}

describe('SQL result header', () => {
  it('reads the row count as the numeral, then time and the statement on screen', () => {
    render(
      <SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={1000} statementPosition={{ index: 1, total: 2 }} />
    );
    expect(screen.getByTestId('result-header-workspace').textContent).toBe('SQL');
    const numeral = screen.getByTestId('sql-status-pill');
    expect(numeral.textContent).toBe('2rows');
    expect(numeral.getAttribute('title')).toBe('Success');
    expect(numeral.dataset.status).toBe('success');
    expect(screen.getByText('38 ms')).toBeTruthy();
    expect(screen.getByTestId('sql-result-preview-statement-count').textContent).toBe(' · statement 1 of 2');
  });

  it('keeps the status badge when there is no row count', () => {
    render(<SqlResultPreview response={response({ status: 'sql-error', rows: [], errorMessage: 'boom' })} isExecuting={false} rowDisplayLimit={1000} />);
    expect(screen.queryByTestId('result-header-numeral')).toBeNull();
    expect(screen.getByTestId('sql-status-pill').textContent).toBe('SQL error');
  });

  it('opens and closes the filter bar from the header, and never closes it on rows it narrows', async () => {
    const user = userEvent.setup();
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={1000} />);
    const toggle = screen.getByTestId('sql-result-filter-toggle');
    expect(screen.queryByTestId('sql-result-preview-filter')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await user.click(toggle);
    const search = screen.getByTestId('sql-result-preview-filter');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    await user.type(search, 'Bog');
    await user.click(toggle);
    expect(screen.getByTestId('sql-result-preview-filter')).toBeTruthy();

    await user.clear(screen.getByTestId('sql-result-preview-filter'));
    await user.click(toggle);
    expect(screen.queryByTestId('sql-result-preview-filter')).toBeNull();
  });

  it('opens the filter bar when the grid sorts, so the sort chip stays in sight', async () => {
    const user = userEvent.setup();
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={1000} />);
    if (screen.queryByTestId('sql-result-preview-filter')) await user.click(screen.getByTestId('sql-result-filter-toggle'));
    await user.click(screen.getByRole('button', { name: /orders/ }));
    expect(screen.getByTestId('sql-sort-chip')).toBeTruthy();
  });

  it('exports from the header action', async () => {
    const user = userEvent.setup();
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={1000} />);
    await user.click(screen.getByTestId('sql-result-preview-export'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

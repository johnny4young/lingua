/**
 * SQL workspace USABILITY upgrade — SqlSchemaBrowser component tests.
 *
 * Isolated render (no DuckDB / no Vite async transform window): list
 * rendering, the column-count chip, collapse toggle, refresh, and the
 * table-insert callback that drives a `SELECT * FROM <t> LIMIT 100`
 * starter into the editor.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  SqlSchemaBrowser,
  type SqlSchemaTable,
} from '../../../src/renderer/components/SqlWorkspace/SqlSchemaBrowser';

const TABLES: SqlSchemaTable[] = [
  { name: 'users', columnCount: 3 },
  { name: 'orders' },
];

describe('SqlSchemaBrowser', () => {
  it('lists the session tables with an optional column-count chip', () => {
    render(
      <SqlSchemaBrowser
        tables={TABLES}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert
      />
    );
    const rows = screen.getAllByTestId('sql-schema-browser-table');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute('data-table-name')).toBe('users');
    // Only the table that supplied a count renders the chip.
    expect(screen.getAllByTestId('sql-schema-browser-col-count')).toHaveLength(
      1
    );
    // The header count badge reflects the table total.
    expect(
      screen.getByTestId('sql-schema-browser-count').textContent
    ).toBe('2');
  });

  it('shows the empty state when there are no tables', () => {
    render(
      <SqlSchemaBrowser
        tables={[]}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert
      />
    );
    expect(screen.getByTestId('sql-schema-browser-empty')).toBeTruthy();
  });

  it('clicking a table fires the insert callback with the table name', async () => {
    const user = userEvent.setup();
    const onInsertTable = vi.fn();
    render(
      <SqlSchemaBrowser
        tables={TABLES}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={onInsertTable}
        canInsert
      />
    );
    await user.click(screen.getAllByTestId('sql-schema-browser-table')[0]!);
    expect(onInsertTable).toHaveBeenCalledWith('users');
  });

  it('disables table insertion when no query is active', () => {
    render(
      <SqlSchemaBrowser
        tables={TABLES}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert={false}
      />
    );
    expect(
      (screen.getAllByTestId('sql-schema-browser-table')[0] as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('the collapse toggle hides + reveals the table list', async () => {
    const user = userEvent.setup();
    render(
      <SqlSchemaBrowser
        tables={TABLES}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert
      />
    );
    expect(screen.getAllByTestId('sql-schema-browser-table')).toHaveLength(2);
    await user.click(screen.getByTestId('sql-schema-browser-toggle'));
    expect(screen.queryAllByTestId('sql-schema-browser-table')).toHaveLength(0);
    await user.click(screen.getByTestId('sql-schema-browser-toggle'));
    expect(screen.getAllByTestId('sql-schema-browser-table')).toHaveLength(2);
  });

  it('fires onRefresh and disables the button while loading', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { rerender } = render(
      <SqlSchemaBrowser
        tables={[]}
        isLoading={false}
        onRefresh={onRefresh}
        onInsertTable={vi.fn()}
        canInsert
      />
    );
    await user.click(screen.getByTestId('sql-schema-browser-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <SqlSchemaBrowser
        tables={[]}
        isLoading
        onRefresh={onRefresh}
        onInsertTable={vi.fn()}
        canInsert
      />
    );
    expect(
      (screen.getByTestId('sql-schema-browser-refresh') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});

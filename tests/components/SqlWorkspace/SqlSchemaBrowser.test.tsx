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

  it('keeps a non-main table label separate from its raw SQL identifiers', async () => {
    const user = userEvent.setup();
    const onInsertTable = vi.fn();
    render(
      <SqlSchemaBrowser
        tables={[
          {
            name: 'lingua_ledger.runs',
            sqlName: 'runs',
            schemaName: 'lingua_ledger',
          },
        ]}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={onInsertTable}
        canInsert
      />
    );

    await user.click(screen.getByTestId('sql-schema-browser-table'));
    expect(onInsertTable).toHaveBeenCalledWith('runs', 'lingua_ledger');
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

  it('expands a table to reveal its column names + types', async () => {
    const user = userEvent.setup();
    const onInsertTable = vi.fn();
    render(
      <SqlSchemaBrowser
        tables={[
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'email', type: 'VARCHAR' },
            ],
          },
          { name: 'orders' },
        ]}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={onInsertTable}
        canInsert
      />
    );

    // The count chip derives from the columns array (2 columns).
    expect(screen.getByTestId('sql-schema-browser-col-count').textContent).toContain(
      '2'
    );
    // Only the table with columns gets an expand toggle.
    const toggles = screen.getAllByTestId('sql-schema-browser-expand');
    expect(toggles).toHaveLength(1);
    // Columns are hidden until expanded.
    expect(screen.queryByTestId('sql-schema-browser-columns')).toBeNull();

    await user.click(toggles[0]!);
    const cols = screen.getAllByTestId('sql-schema-browser-column');
    expect(cols.map((c) => c.getAttribute('data-column-name'))).toEqual([
      'id',
      'email',
    ]);
    expect(cols[0]!.textContent).toContain('INTEGER');

    // Expanding does not fire the insert callback (separate control).
    expect(onInsertTable).not.toHaveBeenCalled();

    // Collapsing hides them again.
    await user.click(toggles[0]!);
    expect(screen.queryByTestId('sql-schema-browser-columns')).toBeNull();
  });

  it('renders the storage chip per mode (implementation OPFS)', () => {
    // Persistent: opfs mode + a usage label.
    const { rerender } = render(
      <SqlSchemaBrowser
        tables={[]}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert
        storageMode="opfs"
        persistRequested
        storageUsageLabel="~5 MB"
      />
    );
    const chip = screen.getByTestId('sql-schema-browser-storage');
    expect(chip.getAttribute('data-storage-mode')).toBe('opfs');
    expect(chip.textContent).toContain('Persistent');
    expect(
      screen.getByTestId('sql-schema-browser-storage-usage').textContent
    ).toContain('~5 MB');

    // In-memory by choice (persistence off): the neutral session label,
    // and NO usage chip.
    rerender(
      <SqlSchemaBrowser
        tables={[]}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert
        storageMode="memory"
        persistRequested={false}
      />
    );
    expect(screen.getByTestId('sql-schema-browser-storage').textContent).toContain(
      'this session'
    );
    expect(
      screen.queryByTestId('sql-schema-browser-storage-usage')
    ).toBeNull();

    // In-memory but persistence WAS requested → "storage unavailable".
    rerender(
      <SqlSchemaBrowser
        tables={[]}
        isLoading={false}
        onRefresh={vi.fn()}
        onInsertTable={vi.fn()}
        canInsert
        storageMode="memory"
        persistRequested
      />
    );
    expect(screen.getByTestId('sql-schema-browser-storage').textContent).toContain(
      'storage unavailable'
    );
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

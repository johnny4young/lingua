import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { applyLocalEdits } = vi.hoisted(() => ({ applyLocalEdits: vi.fn() }));
vi.mock('../../../src/renderer/runtime/sqlLocalEdits', () => ({ applyLocalEdits, loadLocalEditTable: vi.fn() }));

import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import { SqlWriteConfirmDialog } from '../../../src/renderer/components/SqlWorkspace/SqlConnectionDialogs';
import { useSqlRowEdits } from '../../../src/renderer/hooks/useSqlRowEdits';
import type { SqlTablePreview } from '../../../src/renderer/hooks/useSqlTablePreview';
import { useSqlConnectionsStore } from '../../../src/renderer/stores/sqlConnectionsStore';
import type { SqlDbConnectionView } from '../../../src/shared/sqlDb';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const response: SqlResponseV1 = {
  version: 1,
  status: 'success',
  rows: [
    { id: '10401', city: 'Medellin', total: '3410.00' },
    { id: '10402', city: 'Bogota', total: '5021.75' },
  ],
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'city', type: 'VARCHAR' },
    { name: 'total', type: 'DECIMAL' },
  ],
  rowCount: 2,
  durationMs: 3,
  tooLarge: false,
  statementCount: 1,
  recordedAt: '2026-10-22T00:00:00.000Z',
};

const localPreview: SqlTablePreview = {
  table: { name: 'orders' },
  sql: 'SELECT * FROM "orders" LIMIT 100;',
  response,
  edit: { table: { engine: 'duckdb', name: 'orders', columns: ['id', 'city', 'total'], key: { kind: 'pk', columns: ['id'] } } },
};

function Harness({ preview, reload }: { preview: SqlTablePreview; reload: (preview: SqlTablePreview) => void }) {
  const rowEdits = useSqlRowEdits(preview, reload);
  return (
    <>
      <SqlResultPreview
        response={preview.response}
        isExecuting={false}
        rowDisplayLimit={100}
        source={{ origin: 'table', sql: preview.sql, tableName: preview.table.name }}
        rowEdits={rowEdits}
      />
      {rowEdits.confirm ? <SqlWriteConfirmDialog confirm={rowEdits.confirm} onResolve={rowEdits.resolveConfirm} /> : null}
    </>
  );
}

const cell = (row: number, column: string) => within(screen.getAllByTestId('sql-result-preview-row')[row]!).getAllByRole('gridcell').find((td) => td.dataset.column === column)!;

beforeEach(() => applyLocalEdits.mockReset());
afterEach(() => {
  delete (window as { lingua?: unknown }).lingua;
  useSqlConnectionsStore.setState({ catalog: null });
});

describe('staged row edits', () => {
  it('edits a cell in place, shows the change, reviews the SQL, and commits the change set before reading the table again', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    applyLocalEdits.mockResolvedValue({ applied: 1 });
    render(<Harness preview={localPreview} reload={reload} />);
    expect(screen.getByTestId('sql-edit-bar').textContent).toContain('orders · PK id');
    await user.dblClick(cell(0, 'total'));
    const editor = screen.getByTestId('sql-cell-editor');
    await user.clear(editor);
    await user.type(editor, '3450.00{Enter}');
    expect(cell(0, 'total').textContent).toBe('3450.00');
    expect(cell(0, 'total').dataset.edit).toBe('edited');
    expect(screen.getByTestId('sql-edit-count').textContent).toBe('1 staged change');
    await user.click(screen.getByTestId('sql-edit-review'));
    expect(screen.getByTestId('sql-edit-review-panel').textContent).toContain(`UPDATE "orders" SET "total" = '3450.00' WHERE "id" = '10401';`);
    await user.click(screen.getByTestId('sql-edit-commit'));
    await waitFor(() => expect(reload).toHaveBeenCalledWith(localPreview));
    expect(applyLocalEdits).toHaveBeenCalledWith(localPreview.edit && 'table' in localPreview.edit ? localPreview.edit.table : null, {
      updates: [{ key: { id: '10401' }, values: { total: '3450.00' } }],
      deletes: [],
      inserts: [],
    });
    expect(screen.getByTestId('sql-edit-notice').textContent).toBe('Committed 1 change.');
  });

  it('cancels an edit with Escape, sets NULL, deletes, duplicates and adds rows from the menu and the bar, and discards them', async () => {
    const user = userEvent.setup();
    render(<Harness preview={localPreview} reload={vi.fn()} />);
    await user.dblClick(cell(0, 'city'));
    await user.type(screen.getByTestId('sql-cell-editor'), 'x{Escape}');
    expect(screen.queryByTestId('sql-edit-count')).toBeNull();
    fireEvent.contextMenu(cell(0, 'city'));
    await user.click(screen.getByTestId('sql-cell-menu-set-null'));
    fireEvent.contextMenu(cell(1, 'city'));
    await user.click(screen.getByTestId('sql-cell-menu-delete-row'));
    expect(cell(1, 'city').dataset.edit).toBe('deleted');
    fireEvent.contextMenu(cell(0, 'total'));
    await user.click(screen.getByTestId('sql-cell-menu-duplicate-row'));
    await user.click(screen.getByTestId('sql-edit-add'));
    expect(screen.getAllByTestId('sql-result-preview-row')).toHaveLength(4);
    expect(cell(2, 'city').dataset.edit).toBe('inserted');
    expect(cell(3, 'total').textContent).toBe('default');
    expect(screen.getByTestId('sql-column-rail-sample').textContent).toBe('of the 2 rows loaded');
    expect(screen.getByTestId('sql-edit-count').textContent).toBe('4 staged changes');
    await user.click(screen.getByTestId('sql-edit-review'));
    expect(screen.getByTestId('sql-edit-review-panel').textContent).toContain(`DELETE FROM "orders" WHERE "id" = '10402';`);
    expect(screen.getByTestId('sql-edit-review-panel').textContent).toContain(`INSERT INTO "orders" ("city", "total") VALUES (NULL, '3410.00');`);
    await user.click(screen.getByTestId('sql-edit-discard'));
    expect(screen.queryByTestId('sql-edit-count')).toBeNull();
    expect(screen.getAllByTestId('sql-result-preview-row')).toHaveLength(2);
  });

  it('leaves a NULL or default cell alone when its editor closes empty', async () => {
    const user = userEvent.setup();
    const withNull: SqlTablePreview = { ...localPreview, response: { ...response, rows: [{ id: '10401', city: null, total: '3410.00' }] } };
    render(<Harness preview={withNull} reload={vi.fn()} />);
    await user.dblClick(cell(0, 'city'));
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('sql-edit-count')).toBeNull();
    await user.click(screen.getByTestId('sql-edit-add'));
    await user.dblClick(cell(1, 'total'));
    await user.keyboard('{Enter}');
    expect(cell(1, 'total').textContent).toBe('default');
    expect(screen.getByTestId('sql-edit-count').textContent).toBe('1 staged change');
  });

  it('saves an open editor to the row it was opened on, even when the rows move underneath', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness preview={localPreview} reload={vi.fn()} />);
    await user.dblClick(cell(0, 'city'));
    rerender(<Harness preview={{ ...localPreview, response: { ...response, rows: [...response.rows].reverse() } }} reload={vi.fn()} />);
    await user.type(screen.getByTestId('sql-cell-editor'), '!{Enter}');
    expect(cell(1, 'city').textContent).toBe('Medellin!');
    expect(cell(0, 'city').textContent).toBe('Bogota');
  });

  it('keeps a notice to its table, and refuses a connection commit without the desktop bridge', async () => {
    const user = userEvent.setup();
    const remote: SqlTablePreview = {
      ...localPreview,
      connectionId: 'c_1',
      edit: { table: { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city', 'total'], key: { kind: 'pk', columns: ['id'] } } },
    };
    const { rerender } = render(<Harness preview={remote} reload={vi.fn()} />);
    fireEvent.contextMenu(cell(0, 'city'));
    await user.click(screen.getByTestId('sql-cell-menu-set-null'));
    await user.click(screen.getByTestId('sql-edit-commit'));
    expect(screen.getByTestId('sql-edit-notice').textContent).toBe('The changes could not be saved.');
    expect(applyLocalEdits).not.toHaveBeenCalled();
    rerender(<Harness preview={{ ...localPreview, table: { name: 'customers' } }} reload={vi.fn()} />);
    expect(screen.queryByTestId('sql-edit-notice')).toBeNull();
  });

  it('says why a table is read-only and offers no editing', async () => {
    const user = userEvent.setup();
    render(<Harness preview={{ ...localPreview, edit: { reason: 'production' } }} reload={vi.fn()} />);
    expect(screen.getByTestId('sql-edit-readonly').textContent).toBe('Read-only: production connections are never edited here.');
    expect(screen.queryByTestId('sql-edit-bar')).toBeNull();
    await user.dblClick(cell(0, 'city'));
    expect(screen.queryByTestId('sql-cell-editor')).toBeNull();
  });

  it('asks the typed name when main says the connection needs it, even before this catalog copy knows', async () => {
    const user = userEvent.setup();
    const connection = { id: 'c_1', name: 'orders-dev', engine: 'postgres' } as SqlDbConnectionView;
    useSqlConnectionsStore.setState({ catalog: { connections: [connection], adhoc: [], used: 1, limit: 3, vault: 'encrypted' } });
    const applyEdits = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'confirm-needed' }).mockResolvedValueOnce({ ok: true, applied: 1 });
    (window as { lingua?: unknown }).lingua = { platform: 'darwin', db: { applyEdits } };
    const remote: SqlTablePreview = {
      ...localPreview,
      connectionId: 'c_1',
      edit: { table: { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city', 'total'], key: { kind: 'pk', columns: ['id'] } } },
    };
    render(<Harness preview={remote} reload={vi.fn()} />);
    fireEvent.contextMenu(cell(0, 'city'));
    await user.click(screen.getByTestId('sql-cell-menu-set-null'));
    await user.click(screen.getByTestId('sql-edit-commit'));
    expect(await screen.findByTestId('sql-write-confirm')).toBeTruthy();
    await user.type(screen.getByTestId('sql-write-confirm-input'), 'orders-dev');
    await user.click(screen.getByTestId('sql-write-confirm-run'));
    await waitFor(() => expect(applyEdits).toHaveBeenLastCalledWith('c_1', { schema: 'public', name: 'orders' }, expect.anything(), 'orders-dev'));
  });

  it('says the changes were not saved when the call itself fails, and lets the user commit again', async () => {
    const user = userEvent.setup();
    useSqlConnectionsStore.setState({ catalog: { connections: [{ id: 'c_1', name: 'orders-dev', engine: 'postgres' } as SqlDbConnectionView], adhoc: [], used: 1, limit: 3, vault: 'encrypted' } });
    (window as { lingua?: unknown }).lingua = { platform: 'darwin', db: { applyEdits: vi.fn().mockRejectedValue(new Error('Invalid')) } };
    const remote: SqlTablePreview = {
      ...localPreview,
      connectionId: 'c_1',
      edit: { table: { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city', 'total'], key: { kind: 'pk', columns: ['id'] } } },
    };
    render(<Harness preview={remote} reload={vi.fn()} />);
    fireEvent.contextMenu(cell(0, 'city'));
    await user.click(screen.getByTestId('sql-cell-menu-set-null'));
    await user.click(screen.getByTestId('sql-edit-commit'));
    expect((await screen.findByTestId('sql-edit-notice')).textContent).toBe('The changes could not be saved.');
    expect((screen.getByTestId('sql-edit-commit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks the typed name before committing on a connection with Confirm every write, and keeps the change on a refusal', async () => {
    const user = userEvent.setup();
    const connection = { id: 'c_1', name: 'orders-dev', engine: 'postgres', confirmWrites: true } as SqlDbConnectionView;
    useSqlConnectionsStore.setState({ catalog: { connections: [connection], adhoc: [], used: 1, limit: 3, vault: 'encrypted' } });
    const applyEdits = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'raw', edit: { kind: 'conflict', change: 1, touched: 0 } }).mockResolvedValueOnce({ ok: true, applied: 1 });
    (window as { lingua?: unknown }).lingua = { platform: 'darwin', db: { applyEdits } };
    const remote: SqlTablePreview = {
      ...localPreview,
      connectionId: 'c_1',
      edit: { table: { engine: 'postgres', schema: 'public', name: 'orders', columns: ['id', 'city', 'total'], key: { kind: 'pk', columns: ['id'] } } },
    };
    render(<Harness preview={remote} reload={vi.fn()} />);
    await user.dblClick(cell(1, 'city'));
    await user.type(screen.getByTestId('sql-cell-editor'), '!{Enter}');
    await user.click(screen.getByTestId('sql-edit-commit'));
    expect(screen.getByTestId('sql-write-confirm').textContent).toContain(`UPDATE "public"."orders" SET "city" = 'Bogota!' WHERE "id" = '10402'`);
    expect(applyEdits).not.toHaveBeenCalled();
    await user.type(screen.getByTestId('sql-write-confirm-input'), 'orders-dev');
    await user.click(screen.getByTestId('sql-write-confirm-run'));
    await waitFor(() => expect(applyEdits).toHaveBeenCalledTimes(1));
    expect(applyEdits).toHaveBeenCalledWith('c_1', { schema: 'public', name: 'orders' }, { updates: [{ key: { id: '10402' }, values: { city: 'Bogota!' } }], deletes: [], inserts: [] }, 'orders-dev');
    expect((await screen.findByTestId('sql-edit-notice')).textContent).toBe('Change 1 would touch 0 rows instead of one: the table changed since it was read, so nothing was saved.');
    expect(screen.getByTestId('sql-edit-count').textContent).toBe('1 staged change');
  });
});

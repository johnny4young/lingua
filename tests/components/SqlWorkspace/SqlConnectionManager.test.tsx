import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlConnectionManager } from '../../../src/renderer/components/SqlWorkspace/SqlConnectionManager';
import { useSqlConnectionsStore } from '../../../src/renderer/stores/sqlConnectionsStore';
import type { SqlDbCatalogView, SqlDbConnectionView, SqlDbImportResult } from '../../../src/shared/sqlDb';

const saved = (overrides: Partial<SqlDbConnectionView> = {}): SqlDbConnectionView => ({
  version: 1,
  id: 'c_1',
  name: 'orders-dev',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'orders',
  user: 'app',
  ssl: { mode: 'verify-full' },
  env: 'dev',
  readOnly: false,
  passwordMode: 'keychain',
  createdAt: '',
  updatedAt: '',
  hasPassword: true,
  ...overrides,
});

let db: Record<string, ReturnType<typeof vi.fn>>;

function setCatalog(overrides: Partial<SqlDbCatalogView> = {}) {
  const catalog: SqlDbCatalogView = { connections: [], adhoc: [], used: 0, limit: 3, vault: 'encrypted', ...overrides };
  db.catalog!.mockResolvedValue(catalog);
  useSqlConnectionsStore.setState({ catalog });
}

function renderManager(project: { rootId: string; name: string } | null = null) {
  const props = { onClose: vi.fn(), onNew: vi.fn(), onEdit: vi.fn() };
  render(<SqlConnectionManager project={project} {...props} />);
  return props;
}

beforeEach(() => {
  db = {
    catalog: vi.fn(),
    save: vi.fn(async () => ({ ok: true, connection: saved() })),
    delete: vi.fn(async () => ({ ok: true })),
    importFile: vi.fn(),
    importEnv: vi.fn(),
    exportCatalog: vi.fn(),
  };
  (window as { lingua?: unknown }).lingua = { platform: 'darwin', db };
  setCatalog();
});

afterEach(() => {
  delete (window as { lingua?: unknown }).lingua;
  useSqlConnectionsStore.setState({ catalog: null });
});

describe('SqlConnectionManager', () => {
  const list = [
    saved({ id: 'a', name: 'orders-prod', group: 'Ratfel', env: 'prod' }),
    saved({ id: 'b', name: 'billing', engine: 'mysql', host: 'billing.internal', group: 'Ratfel' }),
    saved({ id: 'c', name: 'scratch', group: undefined }),
  ];

  it('groups connections, searches them, and opens one to edit', async () => {
    const user = userEvent.setup();
    setCatalog({ connections: list, used: 3 });
    const { onEdit } = renderManager();
    expect(screen.getByTestId('sql-manager-count').textContent).toBe('3 of 3 saved on Free');
    expect(screen.getAllByTestId('sql-manager-group').map((group) => group.dataset.group)).toEqual(['Ratfel', '']);
    await user.type(screen.getByTestId('sql-manager-search'), 'billing.internal');
    expect(screen.getAllByTestId('sql-manager-row').map((row) => row.dataset.connectionId)).toEqual(['b']);
    await user.click(screen.getByRole('button', { name: 'Edit billing' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('moves a connection to a group, renames a group, duplicates and deletes on the second click', async () => {
    const user = userEvent.setup();
    setCatalog({ connections: list, used: 3, limit: null });
    renderManager();
    const scratch = screen.getAllByTestId('sql-manager-row').find((row) => row.dataset.connectionId === 'c')!;
    await user.click(within(scratch).getByTestId('sql-manager-row-menu'));
    await user.click(screen.getByTestId('sql-manager-move'));
    await user.type(screen.getByTestId('sql-manager-move-input'), 'Clients{Enter}');
    await waitFor(() => expect(db.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'scratch', group: 'Clients' }), 'c', undefined, undefined));
    expect(db.save).toHaveBeenCalledTimes(1);

    db.save.mockClear();
    await user.click(screen.getByTestId('sql-manager-rename'));
    await user.clear(screen.getByTestId('sql-manager-rename-input'));
    await user.type(screen.getByTestId('sql-manager-rename-input'), 'Ratfel SA{Enter}');
    await waitFor(() => expect(db.save).toHaveBeenCalledTimes(2));
    expect(db.save.mock.calls.map((call) => [call[1], (call[0] as { group: string }).group])).toEqual([
      ['a', 'Ratfel SA'],
      ['b', 'Ratfel SA'],
    ]);

    db.save.mockClear();
    const prod = screen.getAllByTestId('sql-manager-row').find((row) => row.dataset.connectionId === 'a')!;
    await user.click(within(prod).getByTestId('sql-manager-row-menu'));
    await user.click(screen.getByTestId('sql-manager-duplicate'));
    await waitFor(() => expect(db.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders-prod copy', group: 'Ratfel' }), undefined, undefined, undefined));

    await user.click(within(prod).getByTestId('sql-manager-row-menu'));
    await user.click(screen.getByTestId('sql-manager-delete'));
    expect(db.delete).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('sql-manager-delete'));
    await waitFor(() => expect(db.delete).toHaveBeenCalledWith('a'));
  });

  it('previews an import, leaves out what is saved, keeps to the Free room and saves with the chosen password mode', async () => {
    const user = userEvent.setup();
    setCatalog({ connections: [list[0]!], used: 1 });
    const found: SqlDbImportResult = {
      canceled: false,
      skipped: 1,
      found: [
        { draft: { ...list[0]!, name: 'same as saved' } },
        { draft: { name: 'shop', engine: 'postgres', host: 'shop.internal', port: 5432, readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' } },
        { draft: { name: 'billing', engine: 'mysql', host: 'b', port: 3306, readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'keychain' } },
        { draft: { name: 'third', engine: 'mysql', host: 't', port: 3306, readOnly: false, ssl: { mode: 'prefer' }, passwordMode: 'none' } },
      ],
    };
    db.importFile!.mockResolvedValue(found);
    renderManager();
    await user.click(screen.getByTestId('sql-manager-import-tableplus'));
    expect(await screen.findByTestId('sql-connection-import')).toBeTruthy();
    expect(db.importFile).toHaveBeenCalledWith('tableplus');
    expect(screen.getAllByTestId('sql-import-duplicate')).toHaveLength(1);
    const boxes = screen.getAllByTestId('sql-import-pick') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true, false]);
    expect(boxes[3]!.disabled).toBe(true);
    expect(screen.getByTestId('sql-import-room').textContent).toBe('Free keeps 3 saved connections: 2 more fit.');
    await user.click(screen.getByTestId('sql-import-password-mode-session'));
    await user.click(screen.getByTestId('sql-import-confirm'));
    await waitFor(() => expect(db.save).toHaveBeenCalledTimes(2));
    expect(db.save.mock.calls.map((call) => [(call[0] as { name: string; passwordMode: string }).name, (call[0] as { passwordMode: string }).passwordMode])).toEqual([
      ['shop', 'session'],
      ['billing', 'session'],
    ]);
    expect((await screen.findByTestId('sql-manager-notice')).textContent).toBe('Imported 2 connections. Each asks for its password the first time it connects.');
  });

  it('reads the open project for .env, says when there is none, and reports an unrecognized file', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SqlConnectionManager project={null} onClose={vi.fn()} onNew={vi.fn()} onEdit={vi.fn()} />);
    expect((screen.getByTestId('sql-manager-import-env') as HTMLButtonElement).disabled).toBe(true);
    unmount();
    db.importEnv!.mockResolvedValue({ canceled: false, found: [], skipped: 0 });
    db.importFile!.mockResolvedValue({ canceled: false, found: [], skipped: 0, error: 'unrecognized' });
    renderManager({ rootId: 'root-1', name: 'shop-api' });
    expect(screen.getByTestId('sql-manager-import-env').textContent).toContain('DATABASE_URL in shop-api');
    await user.click(screen.getByTestId('sql-manager-import-env'));
    expect(db.importEnv).toHaveBeenCalledWith('root-1');
    await user.click(await screen.findByTestId('sql-import-back'));
    await user.click(screen.getByTestId('sql-manager-import-dbeaver'));
    expect((await screen.findByTestId('sql-manager-notice')).textContent).toBe("That file does not look like this client's connection list.");
  });

  it('exports without secrets and says how many', async () => {
    const user = userEvent.setup();
    setCatalog({ connections: list, used: 3 });
    db.exportCatalog!.mockResolvedValue({ canceled: false, ok: true, count: 3 });
    renderManager();
    await user.click(screen.getByTestId('sql-manager-export'));
    expect((await screen.findByTestId('sql-manager-notice')).textContent).toBe('Exported 3 connections, without passwords.');
  });
});

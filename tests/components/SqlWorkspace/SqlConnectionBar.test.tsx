import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SqlConnectionBar, type SqlConnectionPickerRemote } from '../../../src/renderer/components/SqlWorkspace/SqlConnectionBar';
import type { SqlDbCatalogView, SqlDbConnectionView } from '../../../src/shared/sqlDb';

const view = (overrides: Partial<SqlDbConnectionView>): SqlDbConnectionView => ({
  version: 1,
  id: 'c_1',
  name: 'orders-dev',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'orders',
  env: 'dev',
  readOnly: false,
  passwordMode: 'keychain',
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  hasPassword: true,
  ...overrides,
});

const catalog: SqlDbCatalogView = {
  connections: [view({}), view({ id: 'c_2', name: 'orders-prod', env: 'prod', readOnly: true }), view({ id: 'c_3', name: 'inventory.db', engine: 'sqlite', env: undefined, path: '/data/inventory.db' })],
  adhoc: [view({ id: 'adhoc_1', name: 'scratch-url', passwordMode: 'session' })],
  used: 3,
  limit: 3,
  vault: 'encrypted',
};

function remote(overrides: Partial<SqlConnectionPickerRemote> = {}): SqlConnectionPickerRemote {
  return { desktop: true, catalog, activeId: undefined, onSelect: vi.fn(), onNew: vi.fn(), onOpenUrl: vi.fn(), onEdit: vi.fn(), onManage: vi.fn(), ...overrides };
}

describe('SqlConnectionBar', () => {
  it('names Local DuckDB on the pill and lists it first in the picker', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar actions={<button type="button">Import data</button>} />);
    const pill = screen.getByTestId('sql-connection-pill');
    expect(pill.getAttribute('aria-label')).toBe('Connection: Local DuckDB');
    expect(pill.getAttribute('aria-haspopup')).toBe('listbox');
    await user.click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    const option = screen.getByTestId('sql-connection-option-local');
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('This device')).toBeTruthy();
  });

  it('filters the picker and closes on Escape, back on the pill', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.type(screen.getByTestId('sql-connection-search'), 'postgres');
    expect(screen.queryByTestId('sql-connection-option-local')).toBeNull();
    expect(screen.getByText('No connection matches.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('sql-connection-picker')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('sql-connection-pill'));
  });

  it('moves from the search into the option with ArrowDown and returns to the pill on pick', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('sql-connection-option-local'));
    await user.click(screen.getByTestId('sql-connection-option-local'));
    expect(screen.queryByTestId('sql-connection-picker')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('sql-connection-pill'));
  });

  it('lists saved and session connections with the Free count, and picks one', async () => {
    const user = userEvent.setup();
    const props = remote();
    render(<SqlConnectionBar remote={props} />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    expect(screen.getByTestId('sql-connection-saved-count').textContent).toBe('Saved · 3 of 3 on Free');
    const names = screen.getAllByTestId('sql-connection-option').map((option) => option.getAttribute('data-connection-id'));
    expect(names).toEqual(['c_1', 'c_2', 'c_3', 'adhoc_1']);
    expect(screen.getByText('This session only')).toBeTruthy();
    await user.click(screen.getAllByTestId('sql-connection-option')[1]!);
    expect(props.onSelect).toHaveBeenCalledWith('c_2');
  });

  it('colours the pill by environment and marks a read-only connection', () => {
    render(<SqlConnectionBar remote={remote({ activeId: 'c_2' })} />);
    const pill = screen.getByTestId('sql-connection-pill');
    expect(pill.getAttribute('data-env')).toBe('prod');
    expect(pill.getAttribute('aria-label')).toBe('Connection: orders-prod Postgres · RO');
  });

  it('says when the query points at a connection that no longer exists', () => {
    render(<SqlConnectionBar remote={remote({ activeId: 'c_gone' })} />);
    expect(screen.getByTestId('sql-connection-pill').textContent).toContain('Missing connection');
  });

  it('opens the sheet from New, Open from URL and the row menu', async () => {
    const user = userEvent.setup();
    const props = remote();
    render(<SqlConnectionBar remote={props} />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.click(screen.getByTestId('sql-connection-new'));
    expect(props.onNew).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.click(screen.getByTestId('sql-connection-open-url'));
    expect(props.onOpenUrl).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.click(screen.getAllByTestId('sql-connection-edit')[0]!);
    expect(props.onEdit).toHaveBeenCalledWith('c_1');
    await user.click(screen.getByTestId('sql-connection-pill'));
    await user.click(screen.getByTestId('sql-connection-manage'));
    expect(props.onManage).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('lists only Local on web before the catalog is read, with the reason the other engines need desktop', async () => {
    const user = userEvent.setup();
    render(<SqlConnectionBar remote={remote({ desktop: false, catalog: null })} />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    expect(screen.getByTestId('sql-connection-desktop-only')).toBeTruthy();
    expect(screen.queryByTestId('sql-connection-option')).toBeNull();
    expect(screen.queryByTestId('sql-connection-new')).toBeNull();
  });

  it('lists the tab-only connections on web, with New connection and no saved count or manager', async () => {
    const user = userEvent.setup();
    const tab = { ...catalog, connections: [], used: 0, limit: null, vault: 'session' as const, sessionOnly: true, adhoc: [{ ...catalog.connections[0]!, id: 'adhoc_1', name: 'notes', engine: 'libsql' as const }] };
    render(<SqlConnectionBar remote={remote({ desktop: false, catalog: tab })} />);
    await user.click(screen.getByTestId('sql-connection-pill'));
    expect(screen.getByTestId('sql-connection-desktop-only').textContent).toContain('Turso and Neon work here for this tab');
    expect(screen.getByText('This tab only')).toBeTruthy();
    expect(screen.getAllByTestId('sql-connection-option').map((option) => option.textContent)).toEqual([expect.stringContaining('notes')]);
    expect(screen.getByTestId('sql-connection-new')).toBeTruthy();
    expect(screen.queryByTestId('sql-connection-saved-count')).toBeNull();
    expect(screen.queryByTestId('sql-connection-manage')).toBeNull();
  });
});

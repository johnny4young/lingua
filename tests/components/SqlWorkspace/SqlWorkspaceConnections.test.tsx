import type { PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlWorkspacePanel } from '../../../src/renderer/components/SqlWorkspace';
import { resetSqlRunStateForTests } from '../../../src/renderer/hooks/useSqlRunner';
import { __setDuckDbEngineFactoryForTests, type DuckDbEngineHandle } from '../../../src/renderer/runtime/duckdbClient';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useSqlConnectionsStore } from '../../../src/renderer/stores/sqlConnectionsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { resetWorkspaceSqlStoreForTests, useWorkspaceSqlStore } from '../../../src/renderer/stores/workspaceSqlStore';
import type { SqlDbCatalogView, SqlDbConnectionView, SqlDbRunResult } from '../../../src/shared/sqlDb';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';
import { pressSqlChord } from '../../__fixtures__/sqlMonacoMock';

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: PropsWithChildren<{ className?: string }>) => <div className={className}>{children}</div>,
  Panel: ({ children, id }: PropsWithChildren<{ id?: string }>) => <div data-panel-id={id}>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

vi.mock('@monaco-editor/react', async () => (await import('../../__fixtures__/sqlMonacoMock')).sqlMonacoModule);

const connection = (overrides: Partial<SqlDbConnectionView>): SqlDbConnectionView => ({
  version: 1,
  id: 'c_dev',
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
  connections: [
    connection({}),
    connection({ id: 'c_prod', name: 'orders-prod', env: 'prod', readOnly: true }),
    connection({ id: 'c_ask', name: 'billing', engine: 'mysql', env: 'staging', passwordMode: 'session', hasPassword: false }),
  ],
  adhoc: [],
  used: 3,
  limit: 3,
  vault: 'encrypted',
};

const result = (overrides: Partial<SqlDbRunResult> = {}): SqlDbRunResult => ({
  status: 'success',
  engine: 'postgres',
  columns: [{ name: 'id', type: 'INTEGER' }],
  rows: [{ id: 1 }],
  rowCount: 1,
  tooLarge: false,
  rowCountIsLowerBound: false,
  hasMore: false,
  durationMs: 4,
  ...overrides,
});

let db: Record<string, ReturnType<typeof vi.fn>>;
let duckRan: string[];

function localEngine(): DuckDbEngineHandle {
  return {
    connect: async () => ({
      query: async (sql: string) => {
        duckRan.push(sql);
        if (sql.startsWith('SELECT json_serialize_sql')) {
          return { columns: [], rows: [{ j: JSON.stringify({ error: false, statements: [{}] }) }], rowCount: 1, tooLarge: false };
        }
        return { columns: [{ name: 'a', type: 'INTEGER' }], rows: [{ a: 1 }], rowCount: 1, tooLarge: false };
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

function openQuery(sql: string, connectionId?: string) {
  useWorkspaceSqlStore.getState().createQuery({ ...createBlankSqlQuery({ id: 'q1', name: 'Report', query: sql }), ...(connectionId ? { connectionId } : {}) });
}

async function renderPanel() {
  render(<SqlWorkspacePanel />);
  await waitFor(() => expect(useSqlConnectionsStore.getState().catalog).not.toBeNull());
}

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceSqlStoreForTests();
  resetSqlRunStateForTests();
  useUIStore.setState({ statusNotice: null });
  useSettingsStore.setState({ sqlWorkspaceQueryTimeoutMs: 30_000, featureFlags: { dbClient: true } });
  useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
  useSqlConnectionsStore.setState({ catalog: null });
  duckRan = [];
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(localEngine()));
  db = {
    catalog: vi.fn(async () => catalog),
    execute: vi.fn(async () => result()),
    fetch: vi.fn(async () => ({ rows: [], done: true, bytes: 0 })),
    cancel: vi.fn(async () => ({ cancelled: true })),
    closeRun: vi.fn(async () => ({ ok: true })),
    estimate: vi.fn(async () => 12),
    sessionPassword: vi.fn(async () => ({ ok: true })),
  };
  (window as { lingua?: unknown }).lingua = { platform: 'darwin', db };
});

afterEach(() => {
  delete (window as { lingua?: unknown }).lingua;
  useSettingsStore.setState({ featureFlags: {} });
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(localEngine()));
});

describe('SQL workspace on a saved connection', () => {
  it('runs on the SQL host instead of Local, and reads more rows from the host cursor', async () => {
    db.execute.mockResolvedValueOnce(result({ rows: Array.from({ length: 1000 }, (_, id) => ({ id })), rowCount: 1000, hasMore: true, rowCountIsLowerBound: true }));
    db.fetch.mockResolvedValueOnce({ rows: Array.from({ length: 500 }, (_, id) => ({ id: id + 1000 })), done: true, bytes: 4000 });
    openQuery('SELECT id FROM orders', 'c_dev');
    await renderPanel();
    expect(screen.getByTestId('sql-connection-pill').getAttribute('data-env')).toBe('dev');
    act(() => pressSqlChord('statement'));
    await waitFor(() => expect(db.execute).toHaveBeenCalledTimes(1));
    expect(db.execute.mock.calls[0]?.slice(1, 3)).toEqual(['c_dev', 'SELECT id FROM orders']);
    // Local still loads its own explorer catalog; the statement itself never reaches it.
    expect(duckRan).not.toContain('SELECT id FROM orders');
    fireEvent.click(await screen.findByTestId('sql-result-load-more'));
    await waitFor(() => expect(db.fetch).toHaveBeenCalledTimes(1));
    expect(useWorkspaceSqlStore.getState().history[0]).toMatchObject({ status: 'success' });
  });

  it('keeps Profile, Save as table and the full export, which re-run on Local, off a remote result', async () => {
    db.execute.mockResolvedValueOnce(result({ rows: Array.from({ length: 1000 }, (_, id) => ({ id })), rowCount: 1000, hasMore: true, rowCountIsLowerBound: true }));
    openQuery('SELECT id FROM orders', 'c_dev');
    await renderPanel();
    act(() => pressSqlChord('statement'));
    fireEvent.click(await screen.findByTestId('sql-result-preview-export'));
    expect(screen.queryByRole('tab', { name: 'Profile' })).toBeNull();
    expect(screen.queryByTestId('sql-export-scope-full')).toBeNull();
    expect(screen.queryByTestId('sql-export-save-table')).toBeNull();
    expect(screen.getByTestId('sql-export-save-table-unavailable').textContent).toBe('Runs on Local only; this result came from a saved connection.');
    expect(screen.getByTestId('sql-export-send-python')).toBeTruthy();
  });

  it('asks for the typed name with an estimate before a production write, and Cancel sends nothing', async () => {
    openQuery("UPDATE customers SET plan = 'pro' WHERE id <= 10", 'c_prod');
    await renderPanel();
    expect(screen.getByTestId('sql-prod-banner').textContent).toContain('orders-prod');
    act(() => pressSqlChord('statement'));
    const dialog = await screen.findByTestId('sql-write-confirm');
    expect(dialog.textContent).toContain('read-only');
    await waitFor(() => expect(screen.getByTestId('sql-write-confirm-estimate').textContent).toBe('Estimated rows: 12 (EXPLAIN).'));
    expect((screen.getByTestId('sql-write-confirm-run') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('sql-write-confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('sql-write-confirm')).toBeNull());
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('runs a confirmed production write read-write for that run only', async () => {
    db.execute.mockResolvedValueOnce(result({ columns: [], rows: [], rowCount: 0, affectedRows: 10 }));
    openQuery("UPDATE customers SET plan = 'pro' WHERE id <= 10", 'c_prod');
    await renderPanel();
    act(() => pressSqlChord('statement'));
    fireEvent.change(await screen.findByTestId('sql-write-confirm-input'), { target: { value: 'orders-prod' } });
    fireEvent.click(screen.getByTestId('sql-write-confirm-run'));
    await waitFor(() => expect(db.execute).toHaveBeenCalledTimes(1));
    expect(db.execute.mock.calls[0]?.[3]).toEqual({ timeoutMs: 30_000, readWrite: { confirmName: 'orders-prod' } });
    expect((await screen.findAllByText('Count')).length).toBeGreaterThan(0);
  });

  it('asks for a session password, retries with it, and says so when the server refuses it', async () => {
    const needed = result({ status: 'connection-failed', engine: 'mysql', columns: [], rows: [], rowCount: 0, fix: 'password-needed', errorMessage: 'This connection needs its password.' });
    db.execute.mockResolvedValueOnce(needed).mockResolvedValueOnce({ ...needed, errorMessage: 'Access denied' }).mockResolvedValueOnce(result({ engine: 'mysql' }));
    openQuery('SELECT 1', 'c_ask');
    await renderPanel();
    act(() => pressSqlChord('statement'));
    fireEvent.change(await screen.findByTestId('sql-password-input'), { target: { value: 'wrong' } });
    expect(screen.queryByTestId('sql-password-refused')).toBeNull();
    fireEvent.click(screen.getByTestId('sql-password-connect'));
    await screen.findByTestId('sql-password-refused');
    expect(db.sessionPassword).toHaveBeenCalledWith('c_ask', 'wrong');
    expect(screen.getByTestId('sql-result-preview-error-connection-failed').textContent).toContain('Access denied');
    fireEvent.change(screen.getByTestId('sql-password-input'), { target: { value: 'right' } });
    fireEvent.click(screen.getByTestId('sql-password-connect'));
    await waitFor(() => expect(db.execute).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByTestId('sql-password-input')).toBeNull());
  });

  it('refuses to run on a connection that no longer exists', async () => {
    openQuery('SELECT 1', 'c_gone');
    await renderPanel();
    act(() => pressSqlChord('statement'));
    await waitFor(() => expect(useUIStore.getState().statusNotice?.messageKey).toBe('sqlWorkspace.connection.missing'));
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('runs on Local when the Labs flag is off, whatever the query points at', async () => {
    useSettingsStore.setState({ featureFlags: {} });
    openQuery('SELECT 1', 'c_dev');
    render(<SqlWorkspacePanel />);
    expect(screen.getByTestId('sql-connection-pill').getAttribute('data-env')).toBe('local');
    act(() => pressSqlChord('statement'));
    await waitFor(() => expect(useWorkspaceSqlStore.getState().history).toHaveLength(1));
    expect(db.execute).not.toHaveBeenCalled();
    expect(duckRan).toContain('SELECT 1');
  });

  it('names the saved connection in the save popover', async () => {
    openQuery('SELECT 1', 'c_dev');
    await renderPanel();
    act(() => pressSqlChord('saveAs'));
    expect((await screen.findByTestId('sql-save-connection')).textContent).toBe('orders-dev · Postgres');
  });
});

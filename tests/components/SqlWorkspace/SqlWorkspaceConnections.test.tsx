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
import type { SqlDbCatalogView, SqlDbConnectionView, SqlDbIntrospect, SqlDbIntrospectResult, SqlDbRunResult } from '../../../src/shared/sqlDb';
import { useSqlRemoteCatalogStore } from '../../../src/renderer/stores/sqlRemoteCatalogStore';
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

const ORDERS_DETAIL: SqlDbIntrospectResult = {
  detail: {
    kind: 'table',
    schema: 'public',
    name: 'orders',
    columns: [
      { name: 'id', type: 'bigint', nullable: false, default: "nextval('orders_id_seq')", primaryKey: true },
      { name: 'customer_id', type: 'bigint', nullable: false, references: { schema: 'public', table: 'customers', column: 'id' } },
      { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
    ],
    indexes: [
      { name: 'orders_pkey', columns: ['id'], unique: true, primary: true },
      { name: 'orders_by_day', columns: ['created_at'], unique: false, primary: false },
    ],
    rowEstimate: 1_200_000,
    sizeBytes: 214 * 1024 * 1024,
    ddl: 'CREATE TABLE public.orders (\n  id bigint PRIMARY KEY\n);',
  },
};

function introspection(request: SqlDbIntrospect): SqlDbIntrospectResult {
  switch (request.level) {
    case 'schemas':
      return { schemas: [{ name: 'public', objects: 3 }, { name: 'billing', objects: 1 }] };
    case 'objects':
      return request.schema === 'public'
        ? {
            objects: [
              { kind: 'table', name: 'orders', rowEstimate: 1_200_000 },
              { kind: 'view', name: 'orders_by_day' },
              { kind: 'function', name: 'order_total', signature: 'bigint' },
            ],
          }
        : { objects: [{ kind: 'table', name: 'invoices', rowEstimate: 40 }] };
    case 'columns':
      return { columns: [{ table: 'orders', name: 'id', type: 'bigint' }] };
    case 'detail':
      return ORDERS_DETAIL;
  }
}

const introspected = (level: SqlDbIntrospect['level']) =>
  db.introspect.mock.calls.filter(([, request]) => (request as SqlDbIntrospect).level === level).map(([id, request]) => [id, request]);

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
    introspect: vi.fn(async (_id: string, request: SqlDbIntrospect) => introspection(request)),
  };
  useSqlRemoteCatalogStore.setState({ catalogs: {} });
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

  it('shows every write of a production run in the confirm, not just the first', async () => {
    openQuery("UPDATE a SET x = 1;\nDELETE FROM b;\nSELECT 1", 'c_prod');
    await renderPanel();
    act(() => pressSqlChord('all'));
    const card = await screen.findByTestId('sql-write-confirm');
    expect(card.textContent).toContain('UPDATE a SET x = 1');
    expect(card.textContent).toContain('DELETE FROM b');
    expect(screen.getByTestId('sql-write-confirm-many').textContent).toContain('2 statements that write');
  });

  it('waits for the catalog instead of calling a just-launched connection missing', async () => {
    openQuery('SELECT 1', 'c_dev');
    render(<SqlWorkspacePanel />);
    useSqlConnectionsStore.setState({ catalog: null });
    act(() => pressSqlChord('statement'));
    await waitFor(() => expect(db.execute).toHaveBeenCalledTimes(1));
    expect(useUIStore.getState().statusNotice?.messageKey).not.toBe('sqlWorkspace.connection.missing');
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

describe('Explorer on a saved connection', () => {
  it('reads the schemas, opens the first on its tables, and reads another schema only when it opens', async () => {
    openQuery('SELECT 1', 'c_dev');
    await renderPanel();
    await screen.findByText('orders-dev', { selector: '[data-testid="sql-remote-connection"] *' });
    await waitFor(() => expect(screen.getAllByTestId('sql-remote-object').map((row) => row.getAttribute('data-object-name'))).toEqual(['orders']));
    expect(screen.getByTestId('sql-remote-row-estimate').textContent).toBe('1.2M');
    expect(screen.queryByTestId('sql-explorer-local')).toBeNull();
    expect(introspected('objects')).toEqual([['c_dev', { level: 'objects', schema: 'public' }]]);
    fireEvent.click(screen.getByTestId('sql-remote-group-views'));
    expect(screen.getAllByTestId('sql-remote-object').map((row) => row.getAttribute('data-object-name'))).toEqual(['orders', 'orders_by_day']);
    fireEvent.click(screen.getAllByTestId('sql-remote-schema').find((row) => row.getAttribute('data-node-name') === 'billing')!);
    await waitFor(() => expect(introspected('objects')).toHaveLength(2));
    // Refresh drops what was read and reads it again.
    fireEvent.click(screen.getByTestId('sql-explorer-refresh'));
    await waitFor(() => expect(introspected('schemas')).toHaveLength(2));
  });

  it('shows an object in the results area and reads its rows on the connection, never on Local', async () => {
    openQuery('SELECT 1', 'c_dev');
    await renderPanel();
    fireEvent.click(await screen.findByTestId('sql-remote-object'));
    const detail = await screen.findByTestId('sql-object-detail');
    await waitFor(() => expect(screen.getAllByTestId('sql-object-column')).toHaveLength(3));
    expect(screen.getByTestId('sql-object-facts').textContent).toBe('≈1.2M rows · 214 MB');
    expect(screen.getAllByTestId('sql-object-column').map((row) => row.lastElementChild?.textContent)).toEqual(['PK', 'FK → customers.id', 'idx']);
    expect(screen.getByTestId('sql-object-ddl').textContent).toContain('CREATE TABLE public.orders');
    expect(detail.getAttribute('data-object-kind')).toBe('table');

    fireEvent.click(screen.getByTestId('sql-object-insert-select'));
    await waitFor(() =>
      expect((screen.getByTestId('sql-query-editor-textarea') as HTMLTextAreaElement).value).toBe('SELECT 1\nSELECT * FROM "public"."orders" LIMIT 100;')
    );

    fireEvent.click(screen.getByTestId('sql-object-tab-data'));
    await waitFor(() => expect(db.execute).toHaveBeenCalledTimes(1));
    expect(db.execute.mock.calls[0]?.slice(1, 3)).toEqual(['c_dev', 'SELECT * FROM "public"."orders" LIMIT 100;']);
    expect(duckRan.some((sql) => sql.includes('"public"."orders"'))).toBe(false);
    await screen.findByTestId('sql-object-detail');
  });

  it('asks for the password a session connection needs before its catalog, then reads it', async () => {
    db.introspect.mockResolvedValueOnce({ errorMessage: 'This connection needs its password.', fix: 'password-needed' });
    openQuery('SELECT 1', 'c_ask');
    await renderPanel();
    fireEvent.click(await screen.findByTestId('sql-remote-enter-password'));
    fireEvent.change(screen.getByTestId('sql-password-input'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('sql-password-connect'));
    await waitFor(() => expect(db.sessionPassword).toHaveBeenCalledWith('c_ask', 'pw'));
    await waitFor(() => expect(introspected('schemas')).toHaveLength(2));
    // MySQL keeps its functions and procedures under Routines.
    expect(await screen.findByTestId('sql-remote-group-tables')).toBeTruthy();
    expect(screen.queryByTestId('sql-remote-group-matviews')).toBeNull();
  });

  it('keeps Local and its tree when the query runs on Local', async () => {
    openQuery('SELECT 1');
    await renderPanel();
    expect(await screen.findByTestId('sql-explorer-local')).toBeTruthy();
    expect(screen.queryByTestId('sql-remote-tree')).toBeNull();
    expect(db.introspect).not.toHaveBeenCalled();
  });
});

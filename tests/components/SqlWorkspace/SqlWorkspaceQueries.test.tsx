import type { PropsWithChildren } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlWorkspacePanel } from '../../../src/renderer/components/SqlWorkspace';
import {
  CANCEL_SETTLE_MS,
  __setDuckDbEngineFactoryForTests,
  type DuckDbConnection,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';
import { emitCommand } from '../../../src/renderer/stores/commandBus';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import {
  resetWorkspaceSqlStoreForTests,
  useWorkspaceSqlStore,
} from '../../../src/renderer/stores/workspaceSqlStore';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';
import { createDefaultTab } from '../../../src/renderer/stores/editorTabUtils';
import { moveSqlCursor, pressSqlChord } from '../../__fixtures__/sqlMonacoMock';

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  Panel: ({ children, id }: PropsWithChildren<{ id?: string }>) => <div data-panel-id={id}>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

vi.mock('@monaco-editor/react', async () => (await import('../../__fixtures__/sqlMonacoMock')).sqlMonacoModule);

const PLAN = JSON.stringify({
  latency: 0,
  system_peak_buffer_memory: 0,
  children: [
    {
      operator_name: 'EXPLAIN_ANALYZE',
      children: [
        {
          operator_name: 'HASH_GROUP_BY',
          operator_timing: 0.002,
          operator_cardinality: 3,
          extra_info: { Groups: '#0' },
          children: [{ operator_name: 'TABLE_SCAN', operator_timing: 0.001, operator_cardinality: 9, children: [] }],
        },
      ],
    },
  ],
});

/** An engine whose `query` answers by SQL; `ran` records every statement. */
function scriptEngine(ran: string[], overrides: Partial<DuckDbConnection> = {}): DuckDbEngineHandle {
  return {
    connect: async () => ({
      query: async (sql: string) => {
        ran.push(sql);
        if (sql.startsWith('EXPLAIN')) {
          return { columns: [], rows: [{ explain_key: 'analyzed_plan', explain_value: PLAN }], rowCount: 1, tooLarge: false };
        }
        if (sql.includes('broken')) throw new Error('Catalog Error: broken does not exist');
        return { columns: [{ name: 'a', type: 'INTEGER' }], rows: [{ a: 1 }], rowCount: 1, tooLarge: false };
      },
      close: async () => undefined,
      ...overrides,
    }),
    terminate: async () => undefined,
  };
}

function setFree() {
  useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
}

function openQuery(sql: string, extra: Partial<Parameters<typeof createBlankSqlQuery>[0]> = {}) {
  useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'q1', name: 'Report', query: sql, ...extra }));
}

let ran: string[] = [];

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceSqlStoreForTests();
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useUIStore.setState({ statusNotice: null });
  useSettingsStore.setState({ sqlWorkspaceQueryTimeoutMs: 30_000, sqlWorkspacePersistTables: false });
  setFree();
  ran = [];
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(scriptEngine(ran)));
});

afterEach(() => {
  vi.useRealTimers();
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(scriptEngine([])));
});

describe('SQL query tabs and the Free budget', () => {
  it('counts query tabs toward the three Free tabs and shows the hint', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addTab(createDefaultTab('javascript'));
    useEditorStore.getState().addSqlTab();
    openQuery('SELECT 1');
    render(<SqlWorkspacePanel />);
    expect(screen.getByTestId('sql-query-tabs-free-hint').textContent).toBe('Free: 3 open tabs, SQL included');

    await user.click(screen.getByTestId('sql-query-tabs-create'));
    expect(useWorkspaceSqlStore.getState().openQueryIds).toHaveLength(2);
    expect(screen.getAllByTestId('sql-query-tab')[1]?.textContent).toContain('Scratch 1');

    await user.click(screen.getByTestId('sql-query-tabs-create'));
    expect(useWorkspaceSqlStore.getState().openQueryIds).toHaveLength(2);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
    // And a code tab cannot squeeze in past the SQL query tabs either.
    useEditorStore.getState().addTab(createDefaultTab('python'));
    expect(useEditorStore.getState().tabs.filter((tab) => tab.kind !== 'sql')).toHaveLength(1);
  });

  it('asks before closing a scratch with text, and Discard drops it', async () => {
    const user = userEvent.setup();
    openQuery('SELECT 1', { kind: 'scratch', name: 'Scratch 1' });
    render(<SqlWorkspacePanel />);
    expect(screen.getByTestId('sql-query-tab-unsaved')).toBeTruthy();
    await user.click(screen.getByTestId('sql-query-tab-close'));
    expect(screen.getByTestId('sql-close-scratch')).toBeTruthy();
    await user.click(screen.getByTestId('sql-close-scratch-confirm'));
    expect(useWorkspaceSqlStore.getState().queries).toHaveLength(0);
    expect(screen.getByTestId('sql-workspace-empty')).toBeTruthy();
  });

  it('saves a scratch into a new folder with Mod+S', async () => {
    const user = userEvent.setup();
    openQuery('SELECT 1', { kind: 'scratch', name: 'Scratch 1' });
    render(<SqlWorkspacePanel />);
    act(() => pressSqlChord('save'));
    const popover = screen.getByTestId('sql-save-popover');
    expect(within(popover).getByTestId('sql-save-connection').textContent).toBe('Local · DuckDB');
    await user.clear(screen.getByTestId('sql-save-name'));
    await user.type(screen.getByTestId('sql-save-name'), 'Orders by city');
    await user.selectOptions(screen.getByTestId('sql-save-folder'), 'New folder…');
    await user.type(screen.getByTestId('sql-save-new-folder'), 'Reports');
    await user.click(screen.getByTestId('sql-save-confirm'));
    expect(useWorkspaceSqlStore.getState().getQuery('q1')).toMatchObject({ name: 'Orders by city', folder: 'Reports' });
    expect(useWorkspaceSqlStore.getState().getQuery('q1')?.kind).toBeUndefined();
    expect(screen.getByTestId('sql-query-folder').textContent).toContain('Reports');
  });

  it('saves a copy with Save as from the app shortcut', async () => {
    const user = userEvent.setup();
    openQuery('SELECT 1');
    render(<SqlWorkspacePanel />);
    act(() => {
      emitCommand('workspace.save', { kind: 'sql', as: true });
    });
    expect((screen.getByTestId('sql-save-name') as HTMLInputElement).value).toBe('Report copy');
    await user.click(screen.getByTestId('sql-save-confirm'));
    const state = useWorkspaceSqlStore.getState();
    expect(state.queries).toHaveLength(2);
    expect(state.openQueryIds).toEqual([state.activeQueryId]);
    expect(state.getQuery(state.activeQueryId!)?.name).toBe('Report copy');
  });
});

describe('SQL run modes', () => {
  it('runs every statement on one connection with a result tab each, and stops at the first error', async () => {
    openQuery('SELECT 1; SELECT broken; SELECT 3');
    render(<SqlWorkspacePanel />);
    act(() => pressSqlChord('all'));
    await screen.findByTestId('sql-result-tabs');
    expect(ran.filter((sql) => !sql.startsWith('SELECT table_schema') && !sql.includes('duckdb_'))).toEqual([
      'SELECT 1',
      'SELECT broken',
    ]);
    expect(screen.getByTestId('sql-result-tab-result-0').textContent).toBe('Result 1 · 1 row');
    expect(screen.getByTestId('sql-result-tab-result-1').textContent).toBe('Result 2 · SQL error');
    fireEvent.click(screen.getByTestId('sql-result-tab-messages'));
    const statuses = screen.getAllByTestId('sql-run-message').map((line) => line.dataset.status);
    expect(statuses).toEqual(['success', 'sql-error', 'not-run']);
    const history = useWorkspaceSqlStore.getState().history;
    expect(history.map((entry) => [entry.sql, entry.status])).toEqual([
      ['SELECT broken', 'sql-error'],
      ['SELECT 1', 'success'],
    ]);
    expect(history[0]).not.toHaveProperty('rows');
  });

  it('opens Explain in the Plan view without touching the query', async () => {
    openQuery('SELECT city, count(*) FROM t GROUP BY 1');
    render(<SqlWorkspacePanel />);
    fireEvent.click(screen.getByTestId('sql-query-editor-run-menu'));
    fireEvent.click(screen.getByTestId('sql-run-menu-explain'));
    await screen.findByTestId('sql-plan-view');
    expect(ran).toContain('EXPLAIN (ANALYZE, FORMAT JSON) SELECT city, count(*) FROM t GROUP BY 1');
    const nodes = screen.getAllByTestId('sql-plan-node');
    expect(nodes.map((node) => node.querySelector('span')?.textContent)).toEqual(['HASH_GROUP_BY', 'TABLE_SCAN']);
    expect(nodes[0]?.dataset.slowest).toBe('true');
    expect(screen.getByTestId('sql-plan-total').textContent).toBe('Total 3.00 ms');
    expect(useWorkspaceSqlStore.getState().getQuery('q1')?.query).toBe('SELECT city, count(*) FROM t GROUP BY 1');
    expect(useWorkspaceSqlStore.getState().history).toEqual([]);
  });

  it('runs the statement under the cursor and the gutter-free default is the first one', async () => {
    const sql = 'SELECT 1;\nSELECT 2';
    openQuery(sql);
    render(<SqlWorkspacePanel />);
    act(() => moveSqlCursor(sql.length));
    act(() => pressSqlChord('statement'));
    await waitFor(() => expect(useWorkspaceSqlStore.getState().history).toHaveLength(1));
    expect(useWorkspaceSqlStore.getState().history[0]?.sql).toBe('SELECT 2');
    expect(screen.queryByTestId('sql-result-tabs')).toBeNull();
  });

  it('cancels a running query, records it, and the next query still runs', async () => {
    let release: () => void = () => {};
    let first = true;
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        scriptEngine(ran, {
          stream: async () => ({
            fields: () => [],
            next: () =>
              first
                ? new Promise<null>((resolve) => {
                    release = () => resolve(null);
                  })
                : Promise.resolve(null),
          }),
          cancel: async () => {
            first = false;
            release();
            return true;
          },
        })
      )
    );
    openQuery('SELECT * FROM range(100000000)');
    render(<SqlWorkspacePanel />);
    act(() => pressSqlChord('statement'));
    fireEvent.click(await screen.findByTestId('sql-query-editor-cancel'));
    await screen.findByTestId('sql-result-preview-cancelled');
    expect(useWorkspaceSqlStore.getState().history[0]?.status).toBe('cancelled');
    expect(screen.queryByTestId('sql-stuck-band')).toBeNull();
    await screen.findByTestId('sql-query-editor-run');
    act(() => pressSqlChord('statement'));
    await waitFor(() => expect(useWorkspaceSqlStore.getState().history[0]?.status).toBe('success'));
  });

  it('offers to restart the engine when a query ignores Cancel', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const terminate = vi.fn(async () => undefined);
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        ...scriptEngine(ran, {
          stream: async () => ({ fields: () => [], next: () => new Promise<null>(() => {}) }),
          cancel: async () => true,
          close: () => new Promise<void>(() => {}),
        }),
        terminate,
      })
    );
    openQuery('SELECT * FROM stuck');
    render(<SqlWorkspacePanel />);
    act(() => pressSqlChord('statement'));
    fireEvent.click(await screen.findByTestId('sql-query-editor-cancel'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CANCEL_SETTLE_MS);
    });
    fireEvent.click(await screen.findByTestId('sql-restart-engine'));
    await waitFor(() => expect(terminate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('sql-stuck-band')).toBeNull());
  });
});

describe('SQL history section', () => {
  it('searches runs and opens one in a new scratch without running it', async () => {
    const user = userEvent.setup();
    openQuery('SELECT 1');
    useWorkspaceSqlStore.getState().recordHistory({
      version: 1,
      id: 'h1',
      sql: 'SELECT * FROM orders',
      status: 'success',
      durationMs: 4,
      rowCount: 2,
      recordedAt: '2026-10-20T10:00:00.000Z',
    });
    useWorkspaceSqlStore.getState().recordHistory({
      version: 1,
      id: 'h2',
      sql: 'SELECT * FROM cities',
      status: 'sql-error',
      durationMs: 1,
      rowCount: 0,
      recordedAt: '2026-10-20T10:01:00.000Z',
    });
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-history-toggle'));
    await user.type(screen.getByTestId('sql-history-search'), 'orders');
    const rows = screen.getAllByTestId('sql-history-row');
    expect(rows).toHaveLength(1);
    await user.click(rows[0]!);
    const state = useWorkspaceSqlStore.getState();
    const opened = state.getQuery(state.activeQueryId!);
    expect(opened).toMatchObject({ kind: 'scratch', query: 'SELECT * FROM orders' });
    expect(ran.filter((sql) => sql === 'SELECT * FROM orders')).toEqual([]);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  SqlExplorer,
  type SqlExplorerProps,
} from '../../../src/renderer/components/SqlWorkspace/SqlExplorer';
import type { SqlCatalog } from '../../../src/renderer/components/SqlWorkspace/sqlExplorerModel';

const catalog: SqlCatalog = {
  tables: [
    {
      name: 'releases',
      sqlName: 'releases',
      kind: 'table',
      rowCount: 12,
      source: 'csv',
      columns: [
        { name: 'version', type: 'VARCHAR' },
        { name: 'features', type: 'BIGINT' },
      ],
    },
    { name: 'cities', sqlName: 'cities', kind: 'table', rowCount: 3 },
    { name: 'recent', sqlName: 'recent', kind: 'view' },
    { name: 'lingua_ledger.runs', sqlName: 'runs', schemaName: 'lingua_ledger', kind: 'table' },
  ],
  macros: [{ schemaName: 'main', name: 'add_tax' }],
  systemViews: ['columns', 'tables'],
};

function renderExplorer(overrides: Partial<SqlExplorerProps> = {}) {
  const props: SqlExplorerProps = {
    catalog,
    isLoading: false,
    onRefresh: vi.fn(),
    onOpenTable: vi.fn(),
    onFold: vi.fn(),
    onImportFile: vi.fn(),
    isImportBusy: false,
    onTrySample: vi.fn(),
    storageMode: 'memory',
    persistRequested: false,
    storageUsageLabel: null,
    filter: '',
    onFilterChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SqlExplorer {...props} />) };
}

const tableNames = () =>
  screen.getAllByTestId('sql-explorer-table').map(row => row.getAttribute('data-table-name'));

describe('SqlExplorer', () => {
  it('lists Local, main and its tables with row counts and the source tag', () => {
    renderExplorer();
    expect(screen.getByTestId('sql-explorer-storage').textContent).toBe('In-memory · this session');
    expect(tableNames()).toEqual(['releases', 'cities']);
    expect(screen.getAllByTestId('sql-explorer-row-count').map(cell => cell.textContent)).toEqual([
      '12',
      '3',
    ]);
    expect(screen.getByTestId('sql-explorer-source').textContent).toBe('csv');
  });

  it('hides the Run Ledger schema and keeps information_schema collapsed', () => {
    renderExplorer();
    const schemas = screen
      .getAllByTestId('sql-explorer-schema')
      .map(row => row.getAttribute('data-node-name'));
    expect(schemas).toEqual(['main', 'information_schema']);
    expect(screen.queryByText('runs')).toBeNull();
    expect(screen.queryByText('tables')).toBeNull();
  });

  it('opens views and macros as their own groups', async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByTestId('sql-explorer-group-views'));
    expect(tableNames()).toContain('recent');
    await user.click(screen.getByTestId('sql-explorer-group-macros'));
    expect(screen.getByTestId('sql-explorer-macro').textContent).toBe('add_tax');
  });

  it('shows typed columns when a table is expanded, and Collapse all folds the tree', async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getAllByTestId('sql-explorer-expand')[0]!);
    const columns = screen.getAllByTestId('sql-explorer-column');
    expect(columns.map(column => column.textContent)).toEqual(['versionVARCHAR', 'featuresBIGINT']);
    await user.click(screen.getByTestId('sql-explorer-collapse-all'));
    expect(screen.queryByTestId('sql-explorer-table')).toBeNull();
    expect(screen.getByTestId('sql-explorer-local').getAttribute('aria-expanded')).toBe('true');
  });

  it('filters objects, opening every matching branch', () => {
    renderExplorer({ filter: 'rec' });
    expect(tableNames()).toEqual(['recent']);
    expect(screen.queryByTestId('sql-explorer-macro')).toBeNull();
  });

  it('says so when nothing matches', () => {
    renderExplorer({ filter: 'zzz' });
    expect(screen.getByTestId('sql-explorer-no-match')).toBeTruthy();
  });

  it('opens a table from its row', async () => {
    const user = userEvent.setup();
    const { props } = renderExplorer({ openedTableName: 'cities' });
    await user.click(screen.getAllByTestId('sql-explorer-table')[0]!);
    expect(props.onOpenTable).toHaveBeenCalledWith(catalog.tables[0]);
    expect(screen.getAllByTestId('sql-explorer-table')[1]!.getAttribute('aria-current')).toBe(
      'true'
    );
  });

  it('shows the drop target only while a file is dragged over it', () => {
    renderExplorer();
    expect(screen.queryByTestId('sql-explorer-drop-target')).toBeNull();
    fireEvent.dragEnter(screen.getByTestId('sql-explorer'), {
      dataTransfer: { items: [{ kind: 'file', type: 'text/csv' }], types: ['Files'] },
    });
    expect(screen.getByTestId('sql-explorer-drop-target')).toBeTruthy();
  });

  it('offers a sample table when Local has no tables', async () => {
    const user = userEvent.setup();
    const { props } = renderExplorer({ catalog: { tables: [], macros: [], systemViews: [] } });
    expect(screen.getByTestId('sql-explorer-empty').textContent).toContain('No tables yet');
    await user.click(screen.getByTestId('sql-explorer-try-sample'));
    expect(props.onTrySample).toHaveBeenCalledOnce();
  });

  it('folds to the rail from its header', async () => {
    const user = userEvent.setup();
    const { props } = renderExplorer();
    await user.click(screen.getByTestId('sql-explorer-fold'));
    expect(props.onFold).toHaveBeenCalledOnce();
  });
});

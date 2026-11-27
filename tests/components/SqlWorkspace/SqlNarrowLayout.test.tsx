/** The SQL tab under 640 px: the Explorer as rail and drawer, glyph-only QUERY buttons, a short statement count. */

import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { SqlWorkspacePanel } from '../../../src/renderer/components/SqlWorkspace';
import { SqlQueryEditor } from '../../../src/renderer/components/SqlWorkspace/SqlQueryEditor';
import { AskSqlButton } from '../../../src/renderer/components/SqlWorkspace/AskSqlButton';
import { resetSqlRunStateForTests } from '../../../src/renderer/hooks/useSqlRunner';
import { resetWorkspaceSqlStoreForTests, useWorkspaceSqlStore } from '../../../src/renderer/stores/workspaceSqlStore';
import { toggleExplorerOrToolList } from '../../../src/renderer/utils/explorerToggle';
import { toggleSqlExplorer, useSqlExplorerDrawerStore } from '../../../src/renderer/stores/sqlExplorerDrawerStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { createBlankSqlQuery } from '../../../src/shared/sqlWorkspace';
import { __setDuckDbEngineFactoryForTests, type DuckDbEngineHandle } from '../../../src/renderer/runtime/duckdbClient';

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className} data-testid="sql-workspace-layout">
      {children}
    </div>
  ),
  Panel: ({ children, id }: PropsWithChildren<{ id?: string }>) => <div data-panel-id={id}>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));
import { sqlMonacoHarness } from '../../__fixtures__/sqlMonacoMock';

vi.mock('@monaco-editor/react', async () => (await import('../../__fixtures__/sqlMonacoMock')).sqlMonacoModule);
vi.mock('../../../src/renderer/hooks/useEntitlement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/renderer/hooks/useEntitlement')>()),
  useEntitlement: () => true,
}));

const idleEngine: DuckDbEngineHandle = {
  connect: async () => ({ query: async () => ({ columns: [], rows: [] }) as never, close: async () => undefined }),
  terminate: async () => undefined,
};

function atWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect);
}

beforeAll(async () => {
  await initI18n('en');
  await i18next.changeLanguage('en');
});

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceSqlStoreForTests();
  useSqlExplorerDrawerStore.setState({ compact: false, open: false });
  resetSqlRunStateForTests();
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(idleEngine));
});

afterEach(() => vi.restoreAllMocks());

describe('SQL tab under 640 px', () => {
  it('shows the rail and opens the Explorer as a drawer that steps aside for what it opens', async () => {
    atWidth(375);
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'a', name: 'orders by city', query: 'SELECT 1' }));
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'b', name: 'late shipments', query: 'SELECT 2' }));
    useWorkspaceSqlStore.getState().setActiveQuery('a');
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);

    expect(screen.getByTestId('sql-workspace-body').dataset.compact).toBe('true');
    expect(screen.getByTestId('sql-explorer-rail')).toBeTruthy();
    expect(screen.queryByTestId('sql-explorer')).toBeNull();
    expect(screen.queryByTestId('sql-workspace-layout')?.querySelector('[data-panel-id="sql-explorer-pane"]') ?? null).toBeNull();
    await waitFor(() => expect(useSqlExplorerDrawerStore.getState().compact).toBe(true));

    await user.click(screen.getByTestId('sql-explorer-unfold'));
    const drawer = screen.getByRole('dialog', { name: 'Explorer' });
    expect(drawer.dataset.testid).toBe('sql-explorer-drawer');
    expect(drawer.querySelector('[data-testid="sql-explorer"]')).toBeTruthy();
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(false);

    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByTestId('sql-explorer-drawer')).toBeNull();

    await user.click(screen.getByTestId('sql-explorer-unfold'));
    await user.click(within(screen.getByTestId('sql-explorer-drawer')).getByText('late shipments'));
    expect(useWorkspaceSqlStore.getState().activeQueryId).toBe('b');
    await waitFor(() => expect(screen.queryByTestId('sql-explorer-drawer')).toBeNull());
  });

  it('opens the drawer with Cmd/Ctrl+B and its history from the rail, leaving the fold preference alone', async () => {
    atWidth(375);
    useEditorStore.setState({ tabs: [{ id: 'sql', kind: 'sql', name: 'SQL' } as never], activeTabId: 'sql' });
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await waitFor(() => expect(useSqlExplorerDrawerStore.getState().compact).toBe(true));

    await toggleExplorerOrToolList();
    expect(await screen.findByTestId('sql-explorer-drawer')).toBeTruthy();
    await user.click(screen.getByTestId('sql-explorer-fold'));
    expect(screen.queryByTestId('sql-explorer-drawer')).toBeNull();
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(false);

    await user.click(screen.getByTestId('sql-explorer-rail-history'));
    expect(screen.getByTestId('sql-explorer-drawer')).toBeTruthy();
  });

  it('keeps the Explorer beside the editor from 640 px', () => {
    atWidth(640);
    render(<SqlWorkspacePanel />);
    expect(screen.getByTestId('sql-workspace-body').dataset.compact).toBeUndefined();
    expect(screen.getByTestId('sql-explorer')).toBeTruthy();
    expect(screen.queryByTestId('sql-explorer-rail')).toBeNull();
  });
});

describe('QUERY row on a narrow editor', () => {
  const renderEditor = (query: string) =>
    render(
      <SqlQueryEditor
        query={createBlankSqlQuery({ id: 'q', query })}
        onPatch={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        isExecuting={false}
        tables={[]}
        headerExtra={(iconOnly) => <AskSqlButton tables={[]} onInsert={vi.fn()} iconOnly={iconOnly} />}
      />
    );

  it('turns Ask AI and Format into named glyph buttons and shortens the statement count', () => {
    atWidth(331);
    sqlMonacoHarness.layoutWidth = 331;
    renderEditor('SELECT 1; SELECT 2;');
    const format = screen.getByTestId('sql-query-editor-format');
    expect(format.getAttribute('aria-label')).toBe('Format');
    expect(format.textContent).toBe('');
    const ask = screen.getByTestId('ask-sql-trigger');
    expect(ask.getAttribute('aria-label')).toBe('Ask AI for a SQL query');
    expect(ask.textContent).toBe('');
    const statements = screen.getByTestId('sql-query-editor-statements');
    expect(statements.getAttribute('title')).toBe('2 statements · cursor in 1');
    expect(statements.querySelector('[aria-hidden="true"]')?.textContent).toBe('1/2');
    expect(statements.querySelector('.sr-only')?.textContent).toBe('2 statements · cursor in 1');
    expect(screen.getByTestId('sql-query-editor-monaco').dataset.compactGutter).toBe('true');
    sqlMonacoHarness.layoutWidth = 800;
  });

  it('keeps the statement count spelled out from 420 px and the labels from 600 px', () => {
    atWidth(500);
    const { unmount } = renderEditor('SELECT 1; SELECT 2;');
    expect(screen.getByTestId('sql-query-editor-statements').textContent).toBe('2 statements · cursor in 1');
    expect(screen.getByTestId('sql-query-editor-format').textContent).toBe('');
    expect(screen.getByTestId('sql-query-editor-monaco').dataset.compactGutter).toBeUndefined();
    unmount();
    atWidth(600);
    renderEditor('SELECT 1; SELECT 2;');
    expect(screen.getByTestId('sql-query-editor-format').textContent).toBe('Format');
    expect(screen.getByTestId('ask-sql-trigger').textContent).toBe('Ask AI');
  });
});

describe('SQL Explorer drawer store', () => {
  it('routes the toggle to the drawer while compact and to the persisted fold otherwise', () => {
    const drawer = useSqlExplorerDrawerStore.getState();
    drawer.setCompact(true);
    toggleSqlExplorer();
    expect(useSqlExplorerDrawerStore.getState().open).toBe(true);
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(false);
    expect(localStorage.getItem('lingua-workspace-sql-state') ?? '').not.toContain('open');

    // Widening past the drawer drops it, and the toggle folds again.
    useSqlExplorerDrawerStore.getState().setCompact(false);
    expect(useSqlExplorerDrawerStore.getState().open).toBe(false);
    toggleSqlExplorer();
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(true);
  });
});

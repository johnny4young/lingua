/**
 * RL-097 Slice 2 — SqlWorkspacePanel tests.
 *
 * Mirror of `tests/components/HttpWorkspace/HttpWorkspacePanel.test.tsx`.
 * The DuckDB engine is injected via the `__setDuckDbEngineFactoryForTests`
 * seam so we never spin up a real WASM worker.
 */

import type { PropsWithChildren } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlWorkspacePanel } from '../../../src/renderer/components/SqlWorkspace';
import { useExecutionHistoryStore } from '../../../src/renderer/stores/executionHistoryStore';
import {
  resetWorkspaceSqlStoreForTests,
  useWorkspaceSqlStore,
} from '../../../src/renderer/stores/workspaceSqlStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import {
  __setDuckDbEngineFactoryForTests,
  mapArrowTable,
  type ArrowTableLike,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';

function arrowTable(
  columns: ReadonlyArray<{ name: string; type: string }>,
  rows: ReadonlyArray<Record<string, unknown>>
): ArrowTableLike {
  return {
    numRows: rows.length,
    schema: { fields: columns.map((c) => ({ name: c.name, type: { toString: () => c.type } })) },
    toArray: () => [...rows],
  };
}

function happyPathEngine(): DuckDbEngineHandle {
  return {
    connect: async () => ({
      query: async (_sql) => {
        return mapArrowTable(
          arrowTable(
            [{ name: 'a', type: 'INTEGER' }],
            [{ a: 1 }, { a: 2 }]
          )
        );
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
  Panel: ({ children }: PropsWithChildren<{ id?: string }>) => <div>{children}</div>,
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceSqlStoreForTests();
  useExecutionHistoryStore.getState().clear();
  useSettingsStore.setState({
    sqlWorkspaceRowDisplayLimit: 1000,
    sqlWorkspaceQueryTimeoutMs: 30_000,
  });
  useUIStore.setState({ statusNotice: null });
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(happyPathEngine()));
});

afterEach(() => {
  __setDuckDbEngineFactoryForTests(null);
});

describe('SqlWorkspacePanel', () => {
  it('renders the empty state when no query is selected', () => {
    render(<SqlWorkspacePanel />);
    expect(screen.getByTestId('sql-workspace-panel')).toBeTruthy();
    // No active query → empty title in the editor slot.
    expect(screen.getByTestId('sql-query-list')).toBeTruthy();
  });

  it('createQuery makes the editor available', async () => {
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    await waitFor(() => {
      expect(screen.getByTestId('sql-query-editor')).toBeTruthy();
    });
  });

  it('runs a query and records a SQL capsule', async () => {
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    const textarea = screen.getByTestId(
      'sql-query-editor-textarea'
    ) as HTMLTextAreaElement;
    await user.type(textarea, 'SELECT 1');
    await user.click(screen.getByTestId('sql-query-editor-run'));
    await waitFor(() => {
      expect(useWorkspaceSqlStore.getState().getLatestResponse(
        useWorkspaceSqlStore.getState().queries[0]!.id
      )?.status).toBe('success');
    });
    await waitFor(() => {
      const latestCapsule = useExecutionHistoryStore.getState().latestCapsule();
      expect(latestCapsule?.tab.language).toBe('sql');
      expect(latestCapsule?.environment.runner).toBe('duckdb-wasm');
    });
  });

  it('renders the result table after a successful run', async () => {
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    const textarea = screen.getByTestId(
      'sql-query-editor-textarea'
    ) as HTMLTextAreaElement;
    await user.type(textarea, 'SELECT 1');
    await user.click(screen.getByTestId('sql-query-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('sql-result-preview-table')).toBeTruthy();
    });
  });

  it('renders the error band on a SQL error', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => {
            throw new Error('Catalog Error: nonexistent');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    await user.type(
      screen.getByTestId('sql-query-editor-textarea'),
      'SELECT * FROM nonexistent;'
    );
    await user.click(screen.getByTestId('sql-query-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('sql-result-preview-error-sql-error')).toBeTruthy();
    });
  });

  it('renames a query via double-click input', async () => {
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    const row = screen.getByTestId('sql-query-list-row');
    // Double-click on the name span (the truncate span inside the row).
    // userEvent.dblClick on the row triggers the inline rename input.
    const renameTarget = row.querySelector('span.min-w-0') as HTMLElement | null;
    if (renameTarget !== null) {
      await user.dblClick(renameTarget);
    }
    const input = await screen.findByTestId('sql-query-list-rename-input');
    await user.clear(input);
    await user.type(input, 'my-query');
    input.blur();
    await waitFor(() => {
      expect(useWorkspaceSqlStore.getState().queries[0]?.name).toBe('my-query');
    });
  });

  it('Cmd+Enter inside the editor triggers Run', async () => {
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    const textarea = screen.getByTestId(
      'sql-query-editor-textarea'
    ) as HTMLTextAreaElement;
    await user.type(textarea, 'SELECT 1');
    await user.type(textarea, '{Meta>}{Enter}{/Meta}');
    await waitFor(() => {
      expect(useExecutionHistoryStore.getState().latestCapsule()?.tab.language).toBe('sql');
    });
  });
});

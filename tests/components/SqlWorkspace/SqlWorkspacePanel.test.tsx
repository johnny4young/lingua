/**
 * RL-097 Slice 2 — SqlWorkspacePanel tests.
 *
 * Mirror of `tests/components/HttpWorkspace/HttpWorkspacePanel.test.tsx`.
 * The DuckDB engine is injected via the `__setDuckDbEngineFactoryForTests`
 * seam so we never spin up a real WASM worker.
 */

import type { PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlWorkspacePanel } from '../../../src/renderer/components/SqlWorkspace';
import { useExecutionHistoryStore } from '../../../src/renderer/stores/executionHistoryStore';
import {
  resetWorkspaceSqlStoreForTests,
  useWorkspaceSqlStore,
} from '../../../src/renderer/stores/workspaceSqlStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
import { useSessionStore } from '../../../src/renderer/stores/sessionStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useAnnouncerStore } from '../../../src/renderer/stores/announcerStore';
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

// RL-097 Slice 3 — the SQL editor renders Monaco, which cannot mount in jsdom
// (it touches `CSS.escape` + a real theme service). Stand in a controlled
// `<textarea>` that keeps the `sql-query-editor-textarea` testid the panel
// tests query, and routes a real Cmd/Ctrl+Enter keypress to the run command
// captured from the host's `editor.addCommand`, so `{Meta>}{Enter}` still runs
// the query through the same `onRunShortcut` path the production keybinding uses.
vi.mock('@monaco-editor/react', () => {
  // Bit layout that distinguishes the host's two chords (CtrlCmd|Enter vs
  // Shift|Alt|KeyF). Only the values' uniqueness matters here.
  const KeyMod = { CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9 };
  const KeyCode = { Enter: 3, KeyF: 36 };
  const RUN_CHORD = KeyMod.CtrlCmd | KeyCode.Enter;

  const MonacoEditor = ({
    value,
    onChange,
    onMount,
    options,
  }: {
    value: string;
    onChange?: (value: string | undefined) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    options?: { ariaLabel?: string };
  }) => {
    let runCommand: (() => void) | null = null;
    const editor = {
      getSelection: () => null,
      getModel: () => ({ getValueInRange: () => '' }),
      addCommand: (chord: number, callback: () => void) => {
        if (chord === RUN_CHORD) runCommand = callback;
      },
      onDidDispose: () => {},
    };
    const monaco = {
      KeyMod,
      KeyCode,
      editor: { defineTheme: () => {} },
      languages: {
        CompletionItemKind: { Struct: 5, Keyword: 17 },
        registerCompletionItemProvider: () => ({ dispose: () => {} }),
      },
    };
    onMount?.(editor, monaco);
    return (
      <textarea
        data-testid="sql-query-editor-textarea"
        aria-label={options?.ariaLabel}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            runCommand?.();
          }
        }}
      />
    );
  };
  return { default: MonacoEditor, loader: { config: () => {} } };
});

// SQL/HTTP MODEL rework — the workspace-tab-close test drives the real
// `editorStore.closeTab`, whose `removeTab` fires a fire-and-forget
// `import('../runtime/notebookSession')` (lazy by design). That module
// statically pulls `runnerManager` → `esbuild-wasm`, which jsdom rejects
// with the `TextEncoder().encode("") instanceof Uint8Array` invariant.
// Because the import is unawaited, the rejection floats out as an
// unhandled error attributed to whichever workspace-panel test happens
// to be running. The DuckDB engine seam below only guards the SQL engine
// load, not this notebook path — so stub it explicitly here too.
// (`disposeNotebookSession` is the only symbol the `removeTab` path uses.)
vi.mock('../../../src/renderer/runtime/notebookSession', () => ({
  disposeNotebookSession: vi.fn(),
}));


beforeEach(() => {
  localStorage.clear();
  resetWorkspaceSqlStoreForTests();
  useExecutionHistoryStore.getState().clear();
  useSettingsStore.setState({
    sqlWorkspaceRowDisplayLimit: 1000,
    sqlWorkspaceQueryTimeoutMs: 30_000,
    sqlWorkspacePersistTables: false,
  });
  useUIStore.setState({ statusNotice: null });
  useAnnouncerStore.setState({ message: '', nonce: 0 });
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(happyPathEngine()));
});

afterEach(() => {
  // Reset to a benign stub rather than `null`. A `null` factory routes
  // the lazy `getDuckDbEngine()` eager-load (fired by the panel's mount
  // effect) at the production `import('@duckdb/duckdb-wasm')` path, which
  // pulls esbuild-wasm and trips a jsdom TextEncoder invariant as an
  // unhandled rejection during teardown. Keeping the engine mocked
  // through teardown avoids that without changing any assertion.
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(happyPathEngine()));
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
    // UX Sweep T4 — a successful run is announced to screen readers.
    expect(useAnnouncerStore.getState().message).toMatch(/returned/i);
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
    // UX Sweep T4 — a failed run announces the failure, not a row count.
    expect(useAnnouncerStore.getState().message).toMatch(/failed/i);
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

/**
 * SQL/HTTP MODEL rework — collection workspace path. The SQL surface is
 * ONE TablePlus-style collection workspace tab, not one editor tab per
 * query. The in-panel rail is the single source of collection navigation:
 * create / select / delete operate on `useWorkspaceSqlStore` rows
 * (`activeQueryId`), and closing the single workspace tab leaves the
 * collection intact (it rehydrates from its own store). No per-query
 * FileTab is ever minted.
 */
describe('SqlWorkspacePanel — collection workspace (rail-driven)', () => {
  function seedProLicense(): void {
    useLicenseStore.setState({
      token: 'test.token',
      status: {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'test@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(
              Date.now() + 86_400_000
            ).toISOString(),
            entitlements: [],
          },
        },
      },
      lastVerifiedAt: Date.now(),
    });
  }

  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceSqlStoreForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSessionStore.setState({ savedTabs: [], savedActiveIndex: -1 });
    seedProLicense();
    useSettingsStore.setState({ sqlWorkspacePersistTables: false });
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(happyPathEngine())
    );
    // `closeTab` → `removeTab` reaches `window.lingua` only for dirty /
    // disk-backed tabs; freshly-minted workspace tabs skip it. Attach a
    // minimal stub onto the existing jsdom `window` (do NOT replace the
    // whole object, or Testing Library loses the document) so any
    // defensive path resolves cleanly.
    (window as unknown as { lingua: unknown }).lingua = {
      fs: {
        revokeRoot: vi.fn().mockResolvedValue(true),
      },
      confirmCloseTab: vi.fn().mockResolvedValue(1),
    };
  });

  afterEach(() => {
    // Benign stub (not `null`) — see the top-level afterEach note: a
    // `null` factory lets a late eager-load hit the production WASM
    // import and trip esbuild-wasm in jsdom.
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(happyPathEngine())
    );
    useEditorStore.setState({ tabs: [], activeTabId: null });
  });

  it('the single workspace tab carries the stable id; create + adopt never mint a second tab', () => {
    const first = useEditorStore.getState().addSqlTab();
    const second = useEditorStore.getState().addSqlTab();
    // Idempotent: focus-or-create returns the same stable id, never a
    // second SQL tab.
    expect(first).toBe(second);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'sql').length
    ).toBe(1);
  });

  it('in-panel create adds a query row, NOT a new FileTab, and selects it', async () => {
    const user = userEvent.setup();
    // One workspace tab as production has it.
    useEditorStore.getState().addSqlTab();
    render(<SqlWorkspacePanel />);

    const tabsBefore = useEditorStore.getState().tabs.length;
    const queriesBefore = useWorkspaceSqlStore.getState().queries.length;
    await user.click(screen.getByTestId('sql-query-list-create'));

    await waitFor(() => {
      expect(useWorkspaceSqlStore.getState().queries.length).toBe(
        queriesBefore + 1
      );
    });
    // The collection grew but the tab strip did not — no per-query tab.
    expect(useEditorStore.getState().tabs.length).toBe(tabsBefore);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'sql').length
    ).toBe(1);
    // The new query is the store's active selection (rail-driven).
    const newId = useWorkspaceSqlStore.getState().queries[0]!.id;
    expect(useWorkspaceSqlStore.getState().activeQueryId).toBe(newId);
  });

  it('deleting the active rail row removes the query and re-points active; the workspace tab survives', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addSqlTab();
    render(<SqlWorkspacePanel />);

    // Create two queries via the rail; the second is active.
    await user.click(screen.getByTestId('sql-query-list-create'));
    const firstQueryId = useWorkspaceSqlStore.getState().queries[0]!.id;
    await user.click(screen.getByTestId('sql-query-list-create'));
    const secondQueryId = useWorkspaceSqlStore.getState().queries[0]!.id;
    expect(useWorkspaceSqlStore.getState().activeQueryId).toBe(secondQueryId);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deleteButtons = screen.getAllByTestId('sql-query-list-delete');
    // Rows are newest-first → the active (second) query is row 0.
    await user.click(deleteButtons[0]!);
    confirmSpy.mockRestore();

    await waitFor(() => {
      expect(
        useWorkspaceSqlStore.getState().getQuery(secondQueryId)
      ).toBeUndefined();
    });
    // Active re-points to the surviving query; the workspace tab is intact.
    expect(useWorkspaceSqlStore.getState().activeQueryId).toBe(firstQueryId);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'sql').length
    ).toBe(1);
  });

  it('closing the workspace tab keeps the collection (it rehydrates on reopen)', async () => {
    const user = userEvent.setup();
    const tabId = useEditorStore.getState().addSqlTab()!;
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    const queryId = useWorkspaceSqlStore.getState().queries[0]!.id;

    // Close the single workspace tab.
    await useEditorStore.getState().closeTab(tabId);

    // The tab is gone but the collection persists in its own store.
    expect(
      useEditorStore.getState().tabs.some((t) => t.id === tabId)
    ).toBe(false);
    expect(useWorkspaceSqlStore.getState().getQuery(queryId)).toBeDefined();

    // Reopening focus-or-creates the same stable tab; the rail rehydrates.
    const reopened = useEditorStore.getState().addSqlTab();
    expect(reopened).toBe(tabId);
    expect(useWorkspaceSqlStore.getState().getQuery(queryId)).toBeDefined();
  });

  it('renders the schema/table browser inside the rail column', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addSqlTab();
    render(<SqlWorkspacePanel />);
    await user.click(screen.getByTestId('sql-query-list-create'));
    // The collapsible schema browser sits below the query list in the
    // left column. Its SHOW TABLES / PRAGMA introspection + table-insert
    // behaviour are covered as an isolated component test
    // (SqlSchemaBrowser.test.tsx) + the editor insert-signal unit test, to
    // avoid the panel's heavy DuckDB async path (multiple awaited mocked
    // queries widen the run window enough to trip Vite's on-demand
    // esbuild-wasm transform under jsdom).
    expect(screen.getByTestId('sql-schema-browser')).toBeTruthy();
    expect(screen.getByTestId('sql-schema-browser-refresh')).toBeTruthy();
  });

  it('does not label a pending persistence toggle as unavailable before reconnect', () => {
    useEditorStore.getState().addSqlTab();
    useSettingsStore.setState({ sqlWorkspacePersistTables: true });
    useWorkspaceSqlStore.getState().setStorageMode('memory', 'memory');

    render(<SqlWorkspacePanel />);

    const chip = screen.getByTestId('sql-schema-browser-storage');
    expect(chip.textContent).toContain('this session');
    expect(chip.textContent).not.toContain('storage unavailable');
  });

  it('duplicating a rail row clones the query in the store and selects the clone', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addSqlTab();
    render(<SqlWorkspacePanel />);

    // Create + name a query, then give it some text.
    await user.click(screen.getByTestId('sql-query-list-create'));
    const sourceId = useWorkspaceSqlStore.getState().queries[0]!.id;
    useWorkspaceSqlStore.getState().updateQuery(sourceId, {
      name: 'source',
      query: 'SELECT clone_me;',
    });

    const queriesBefore = useWorkspaceSqlStore.getState().queries.length;
    const tabsBefore = useEditorStore.getState().tabs.length;

    // Duplicate the (only) row.
    await user.click(screen.getByTestId('sql-query-list-duplicate'));

    await waitFor(() => {
      expect(useWorkspaceSqlStore.getState().queries.length).toBe(
        queriesBefore + 1
      );
    });
    const state = useWorkspaceSqlStore.getState();
    const clone = state.queries[0]!;
    // Clone copies the text under a new id and is the active selection.
    expect(clone.id).not.toBe(sourceId);
    expect(clone.query).toBe('SELECT clone_me;');
    expect(state.activeQueryId).toBe(clone.id);
    // No per-query FileTab minted by the clone.
    expect(useEditorStore.getState().tabs.length).toBe(tabsBefore);
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'sql').length
    ).toBe(1);
  });

  it('selecting a rail row moves the store active query (no FileTab focus dance)', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().addSqlTab();
    render(<SqlWorkspacePanel />);

    await user.click(screen.getByTestId('sql-query-list-create'));
    const firstId = useWorkspaceSqlStore.getState().queries[0]!.id;
    useWorkspaceSqlStore.getState().updateQuery(firstId, {
      query: 'SELECT first_marker',
    });
    await user.click(screen.getByTestId('sql-query-list-create'));
    const secondId = useWorkspaceSqlStore.getState().queries[0]!.id;
    expect(useWorkspaceSqlStore.getState().activeQueryId).toBe(secondId);

    // Click the row for the first query.
    const rows = screen.getAllByTestId('sql-query-list-row');
    const firstRow = rows.find(
      (r) => r.getAttribute('data-query-id') === firstId
    );
    expect(firstRow).toBeDefined();
    await user.click(firstRow!);

    await waitFor(() => {
      expect(useWorkspaceSqlStore.getState().activeQueryId).toBe(firstId);
    });
    // The editor area never gained a per-query tab.
    expect(
      useEditorStore.getState().tabs.filter((t) => t.kind === 'sql').length
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RL-097 (SQL import) — keyboard-only import flow + preview modal a11y.
// ---------------------------------------------------------------------------

/**
 * An import-capable engine: implements `registerFile` / `dropFile` and
 * canned responses for the preview (`LIMIT`), count, and CREATE TABLE
 * paths. `createCalls` records each CREATE TABLE statement so the test
 * can assert the edited table name reached the DDL.
 */
function importEngine(
  createCalls: string[],
  existingTables: readonly string[] = [],
  options: { readonly createDelay?: Promise<void> } = {}
): DuckDbEngineHandle {
  return {
    registerFile: async () => undefined,
    dropFile: async () => undefined,
    connect: async () => ({
      query: async (sql: string) => {
        if (/CREATE TABLE/i.test(sql)) {
          createCalls.push(sql);
          if (options.createDelay) await options.createDelay;
          return mapArrowTable(arrowTable([], []));
        }
        if (/count\(\*\)/i.test(sql)) {
          return mapArrowTable(
            arrowTable([{ name: 'n', type: 'BIGINT' }], [{ n: 3n }])
          );
        }
        // IT2-C2 — the browser now lists schema-qualified tables from
        // information_schema.tables (SHOW TABLES only saw `main`).
        if (/FROM information_schema\.tables/i.test(sql)) {
          return mapArrowTable(
            arrowTable(
              [
                { name: 'table_schema', type: 'VARCHAR' },
                { name: 'table_name', type: 'VARCHAR' },
              ],
              existingTables.map((name) => ({ table_schema: 'main', table_name: name }))
            )
          );
        }
        if (/PRAGMA table_info/i.test(sql)) {
          return mapArrowTable(
            arrowTable([{ name: 'cid', type: 'INTEGER' }], [{ cid: 0 }])
          );
        }
        // The preview sample read (read_csv_auto … LIMIT 10).
        return mapArrowTable(
          arrowTable(
            [
              { name: 'id', type: 'INTEGER' },
              { name: 'label', type: 'VARCHAR' },
            ],
            [
              { id: 1, label: 'one' },
              { id: 2, label: 'two' },
            ]
          )
        );
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

function csvFile(name = 'Sales Data.csv'): File {
  return new File(['id,label\n1,one\n2,two\n'], name, { type: 'text/csv' });
}

describe('SqlWorkspacePanel — file import (RL-097)', () => {
  it('keyboard path: Import button is a real focusable button with an aria-label', () => {
    render(<SqlWorkspacePanel />);
    const button = screen.getByTestId('sql-workspace-import');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBeTruthy();
    expect(button.className).toContain('focus-ring');
  });

  it('keyboard path: activating Import → picking a file opens the preview dialog with columns + rows', async () => {
    const createCalls: string[] = [];
    __setDuckDbEngineFactoryForTests(() => Promise.resolve(importEngine(createCalls)));
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);

    // Focus the toolbar Import button and activate it by keyboard.
    const importButton = screen.getByTestId('sql-workspace-import');
    importButton.focus();
    expect(document.activeElement).toBe(importButton);
    // Simulate the file selection the native dialog would deliver.
    await user.upload(screen.getByTestId('sql-workspace-import-input'), csvFile());

    // The preview dialog appears with role=dialog + an accessible name.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByTestId('sql-import-modal-confirm').className).toContain(
      'focus-ring'
    );
    expect(screen.getByTestId('sql-import-modal-cancel').className).toContain(
      'focus-ring'
    );
    expect(screen.getByTestId('sql-import-modal-name').className).toContain(
      'focus-ring'
    );
    const labelEl = document.getElementById(
      dialog.getAttribute('aria-labelledby')!
    );
    expect(labelEl?.textContent?.length).toBeGreaterThan(0);

    expect(
      (screen.getByTestId('sql-workspace-import') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('sql-workspace-import-input') as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('sql-schema-browser-import') as HTMLButtonElement)
        .disabled
    ).toBe(true);

    // Detected columns + sample rows render.
    const columns = screen.getByTestId('sql-import-modal-columns');
    expect(columns.textContent).toContain('id');
    expect(columns.textContent).toContain('label');
    expect(screen.getByTestId('sql-import-modal-sample').textContent).toContain(
      'one'
    );
    // Pre-filled, sanitized table name from "Sales Data.csv".
    expect(
      (screen.getByTestId('sql-import-modal-name') as HTMLInputElement).value
    ).toBe('sales_data');
  });

  it('keyboard path: editing the name then Confirm imports under the edited name', async () => {
    const createCalls: string[] = [];
    __setDuckDbEngineFactoryForTests(() => Promise.resolve(importEngine(createCalls)));
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);

    await user.upload(screen.getByTestId('sql-workspace-import-input'), csvFile());
    await screen.findByRole('dialog');

    const nameInput = screen.getByTestId('sql-import-modal-name');
    await user.clear(nameInput);
    await user.type(nameInput, 'custom_table');
    await user.click(screen.getByTestId('sql-import-modal-confirm'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const createStmt = createCalls.find((q) => /CREATE TABLE/i.test(q));
    expect(createStmt).toContain('"custom_table"');
  });

  it('invalid name disables Import + shows the inline hint', async () => {
    __setDuckDbEngineFactoryForTests(() => Promise.resolve(importEngine([])));
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);
    await user.upload(screen.getByTestId('sql-workspace-import-input'), csvFile());
    await screen.findByRole('dialog');

    const nameInput = screen.getByTestId('sql-import-modal-name');
    await user.clear(nameInput);
    await user.type(nameInput, '1bad name');

    expect(
      (screen.getByTestId('sql-import-modal-confirm') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('dedupes suggested names and blocks editing back to an existing table', async () => {
    const createCalls: string[] = [];
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(importEngine(createCalls, ['sales_data']))
    );
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);

    await user.click(screen.getByTestId('sql-schema-browser-refresh'));
    await waitFor(() =>
      expect(
        screen
          .getByTestId('sql-schema-browser-table')
          .getAttribute('data-table-name')
      ).toBe('sales_data')
    );

    await user.upload(screen.getByTestId('sql-workspace-import-input'), csvFile());
    await screen.findByRole('dialog');

    const nameInput = screen.getByTestId(
      'sql-import-modal-name'
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('sales_data_2');
    await user.clear(nameInput);
    await user.type(nameInput, 'sales_data');

    expect(
      (screen.getByTestId('sql-import-modal-confirm') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByTestId('sql-import-modal-name-hint').textContent).toContain(
      'already exists'
    );
    expect(createCalls.filter((q) => /CREATE TABLE/i.test(q))).toHaveLength(0);
  });

  it('Esc / cancel closes the modal and fires no import', async () => {
    const createCalls: string[] = [];
    __setDuckDbEngineFactoryForTests(() => Promise.resolve(importEngine(createCalls)));
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);

    await user.upload(screen.getByTestId('sql-workspace-import-input'), csvFile());
    await screen.findByRole('dialog');

    // Put focus inside the dialog (where it lands on open) so Escape
    // routes through ModalShell's keydown handler, then press it.
    const nameInput = screen.getByTestId('sql-import-modal-name');
    nameInput.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(createCalls.filter((q) => /CREATE TABLE/i.test(q))).toHaveLength(0);
  });

  it('keeps the modal open and disables Cancel while Confirm is importing', async () => {
    const createCalls: string[] = [];
    let releaseCreate!: () => void;
    const createDelay = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(importEngine(createCalls, [], { createDelay }))
    );
    const user = userEvent.setup();
    render(<SqlWorkspacePanel />);

    await user.upload(screen.getByTestId('sql-workspace-import-input'), csvFile());
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByTestId('sql-import-modal-confirm'));
    await waitFor(() =>
      expect(createCalls.filter((q) => /CREATE TABLE/i.test(q))).toHaveLength(1)
    );

    const cancel = screen.getByTestId(
      'sql-import-modal-cancel'
    ) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBe(dialog);

    releaseCreate();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('rejects an unsupported file type with a specific notice and no dialog', async () => {
    __setDuckDbEngineFactoryForTests(() => Promise.resolve(importEngine([])));
    render(<SqlWorkspacePanel />);

    // `fireEvent.change` bypasses the input's `accept` filter (which the
    // OS dialog enforces) so we can prove the runtime guard ALSO rejects a
    // type that slipped through — defence in depth.
    const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const input = screen.getByTestId(
      'sql-workspace-import-input'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [txt] } });

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'sqlWorkspace.import.errorUnsupported'
      );
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the schema-browser "+" import button is a real button with an aria-label', () => {
    render(<SqlWorkspacePanel />);
    const plus = screen.getByTestId('sql-schema-browser-import');
    expect(plus.tagName).toBe('BUTTON');
    expect(plus.getAttribute('aria-label')).toBeTruthy();
    expect(plus.className).toContain('focus-ring');
  });
});

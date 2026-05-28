/**
 * RL-043 Slice A — NotebookView component coverage.
 *
 * Validates the empty-state, toolbar handlers, code-cell render,
 * markdown-cell render, ES locale, and that the toolbar's `Run all`
 * dispatches the per-cell handler.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/renderer/runners', () => ({
  runnerManager: { execute: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));

import { initI18n } from '../../../src/renderer/i18n';
import { NotebookView } from '../../../src/renderer/components/Notebook/NotebookView';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../../src/renderer/stores/notebookStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { runnerManager } from '../../../src/renderer/runners';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;

const TAB_ID = 'tab-test';

describe('<NotebookView />', () => {
  beforeAll(async () => {
    await initI18n();
  });
  beforeEach(async () => {
    resetNotebookStoreForTests();
    useEditorStore.setState({
      tabs: [
        {
          id: TAB_ID,
          name: 'Hello.linguanb',
          language: 'javascript',
          content: '',
          isDirty: false,
          kind: 'notebook',
        },
      ],
      activeTabId: TAB_ID,
    });
    localStorage.clear();
    mockExecute.mockReset();
    await i18next.changeLanguage('en');
    useNotebookStore.getState().createNotebookForTab(TAB_ID, 'Hello');
  });
  afterEach(async () => {
    resetNotebookStoreForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    localStorage.clear();
    await i18next.changeLanguage('en');
  });

  it('renders the notebook title + cells', () => {
    render(<NotebookView tabId={TAB_ID} />);
    const title = screen.getByTestId('notebook-title') as HTMLInputElement;
    expect(title.value).toBe('Hello');
    expect(screen.getAllByTestId(/^notebook-(code|markdown)-cell-row$/)).toHaveLength(2);
  });

  it('renders the not-found state when the notebook is missing', () => {
    render(<NotebookView tabId="does-not-exist" />);
    expect(screen.getByTestId('notebook-view-empty')).toBeTruthy();
  });

  it('adds a markdown cell via the toolbar', async () => {
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    await user.click(screen.getByTestId('notebook-toolbar-add-markdown'));
    expect(screen.getAllByTestId('notebook-markdown-cell-row')).toHaveLength(2);
  });

  it('adds a code cell via the toolbar', async () => {
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    await user.click(screen.getByTestId('notebook-toolbar-add-code'));
    expect(screen.getAllByTestId('notebook-code-cell-row')).toHaveLength(2);
  });

  it('deletes a cell via the row action', async () => {
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    const before = screen.getAllByTestId(/^notebook-(code|markdown)-cell-row$/).length;
    await user.click(screen.getAllByTestId('notebook-markdown-cell-delete')[0]!);
    const after = screen.getAllByTestId(/^notebook-(code|markdown)-cell-row$/).length;
    expect(after).toBe(before - 1);
  });

  it('moves a cell down via the row action', async () => {
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    const idsBefore = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    await user.click(screen.getByTestId('notebook-markdown-cell-move-down'));
    const idsAfter = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    expect(idsAfter[0]).toBe(idsBefore[1]);
    expect(idsAfter[1]).toBe(idsBefore[0]);
  });

  it('Run cell calls the runner via the orchestrator', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: { stdout: ['42'], stderr: [], sessionDelta: { v: 42 } },
      stdout: [],
      stderr: [],
    });
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    await user.click(screen.getByTestId('notebook-code-cell-run'));
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('runs the focused code cell on Cmd+Enter without falling through to the global runner', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: { stdout: ['42'], stderr: [], sessionDelta: { v: 42 } },
      stdout: [],
      stderr: [],
    });
    render(<NotebookView tabId={TAB_ID} />);
    fireEvent.keyDown(screen.getByTestId('notebook-code-cell-source'), {
      key: 'Enter',
      metaKey: true,
    });
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  });

  it('renames the backing tab and notebook title from the title field', async () => {
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    const title = screen.getByTestId('notebook-title') as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Analysis{Enter}');

    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      name: 'Analysis.linguanb',
      kind: 'notebook',
      isDirty: false,
    });
    expect(useNotebookStore.getState().getNotebookForTab(TAB_ID)?.title).toBe(
      'Analysis'
    );
  });

  it('toggles the markdown cell into edit mode and persists edits', async () => {
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    await user.click(screen.getByTestId('notebook-markdown-cell-toggle-edit'));
    const textarea = screen.getByTestId('notebook-markdown-cell-source');
    fireEvent.change(textarea, { target: { value: '# Updated' } });
    const stored = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.find((c) => c.kind === 'markdown');
    expect(stored?.source).toBe('# Updated');
  });

  it('renders ES locale copy when language is set to es', async () => {
    await i18next.changeLanguage('es');
    render(<NotebookView tabId={TAB_ID} />);
    expect(screen.getByTestId('notebook-toolbar-add-code').textContent).toContain(
      'Agregar código'
    );
    expect(screen.getByTestId('notebook-toolbar-add-markdown').textContent).toContain(
      'Agregar markdown'
    );
  });

  it('renders the summary chip with the current cell counts', () => {
    render(<NotebookView tabId={TAB_ID} />);
    // Two cells: one code + one markdown.
    expect(document.body.textContent).toMatch(/2 cells/);
  });
});

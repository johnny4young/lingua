/**
 * RL-043 Slice A — NotebookView component coverage.
 *
 * Validates the empty-state, toolbar handlers, code-cell render,
 * markdown-cell render, ES locale, and that the toolbar's `Run all`
 * dispatches the per-cell handler.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import type { NotebookCellV1 } from '../../../src/shared/notebook';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;

const TAB_ID = 'tab-test';

function seedNotebookCells(cells: NotebookCellV1[], activeCellId = cells[0]?.id ?? null) {
  useNotebookStore.setState({
    notebooks: {
      [TAB_ID]: {
        notebook: {
          version: 1,
          id: 'notebook-test',
          title: 'Hello',
          createdAt: '2026-05-27T00:00:00.000Z',
          cells,
        },
        cellRunStatus: {},
        activeCellId,
      },
    },
  });
}

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

  it('adds new code cells in the notebook tab language for imported Python notebooks', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: TAB_ID,
          name: 'Hello.linguanb',
          language: 'python',
          content: '',
          isDirty: false,
          kind: 'notebook',
        },
      ],
      activeTabId: TAB_ID,
    });
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);

    await user.click(screen.getByTestId('notebook-toolbar-add-code'));

    const codeCells = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.filter((cell) => cell.kind === 'code');
    expect(codeCells.at(-1)).toMatchObject({ language: 'python' });
    const lastSource = screen
      .getAllByTestId('notebook-code-cell-source')
      .at(-1) as HTMLTextAreaElement;
    expect(lastSource.getAttribute('placeholder')).toContain('Python');
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
      structuredResult: { stdout: ['42'], stderr: [], sessionDelta: { v: 42 } },
      stdout: [],
      stderr: [],
    });
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    await user.click(screen.getByTestId('notebook-code-cell-run'));
    // RL-043 Slice B — the run path now awaits a lazy `import('typescript')`
    // before reaching the runner, so wait for the call (matching the other
    // run-cell assertions in this file).
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  });

  it('the cell language selector switches JS to TS and emits the adoption event', async () => {
    const telemetry = await import('../../../src/renderer/utils/telemetry');
    render(<NotebookView tabId={TAB_ID} />);
    const select = screen.getByTestId(
      'notebook-code-cell-language'
    ) as HTMLSelectElement;
    expect(select.value).toBe('javascript');
    fireEvent.change(select, { target: { value: 'typescript' } });
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.find((c) => c.kind === 'code')!;
    expect(codeCell.kind).toBe('code');
    if (codeCell.kind === 'code') expect(codeCell.language).toBe('typescript');
    expect(telemetry.trackEvent).toHaveBeenCalledWith(
      'notebook.cell_language_changed',
      { to: 'typescript' }
    );
  });

  it('the cell language selector keeps Python in the list but disabled (fold C)', async () => {
    const telemetry = await import('../../../src/renderer/utils/telemetry');
    vi.mocked(telemetry.trackEvent).mockClear();
    render(<NotebookView tabId={TAB_ID} />);
    const select = screen.getByTestId('notebook-code-cell-language');
    const python = select.querySelector(
      'option[value="python"]'
    ) as HTMLOptionElement | null;
    expect(python).not.toBeNull();
    expect(python?.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'python' } });
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.find((c) => c.kind === 'code')!;
    expect(codeCell.kind).toBe('code');
    if (codeCell.kind !== 'code') return;
    expect(codeCell.language).toBe('javascript');
    expect(telemetry.trackEvent).not.toHaveBeenCalledWith(
      'notebook.cell_language_changed',
      { to: 'python' }
    );
  });

  it('runs the focused code cell on Cmd+Enter without falling through to the global runner', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: ['42'], stderr: [], sessionDelta: { v: 42 } },
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

  it('Shift+Enter on the last code cell runs it and appends a fresh code cell (Jupyter parity)', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    render(<NotebookView tabId={TAB_ID} />);
    // Seed notebook has one code cell (the last cell). Shift+Enter on
    // it runs + appends a new code cell below.
    const before = screen.getAllByTestId('notebook-code-cell-row').length;
    fireEvent.keyDown(screen.getByTestId('notebook-code-cell-source'), {
      key: 'Enter',
      shiftKey: true,
    });
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByTestId('notebook-code-cell-row').length).toBe(
        before + 1
      )
    );
  });

  it('Alt+Enter runs the cell and inserts a code cell directly below', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    render(<NotebookView tabId={TAB_ID} />);
    const before = screen.getAllByTestId('notebook-code-cell-row').length;
    fireEvent.keyDown(screen.getByTestId('notebook-code-cell-source'), {
      key: 'Enter',
      altKey: true,
    });
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByTestId('notebook-code-cell-row').length).toBe(
        before + 1
      )
    );
  });

  it('Shift+Enter preserves the current code cell language when appending below', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    seedNotebookCells([
      {
        kind: 'code',
        id: 'cell-py',
        language: 'python',
        source: 'print("hi")',
        outputs: [],
      },
    ]);
    render(<NotebookView tabId={TAB_ID} />);

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('notebook-code-cell-source'), {
        key: 'Enter',
        shiftKey: true,
      });
    });

    expect(mockExecute).not.toHaveBeenCalled();
    await waitFor(() => {
      const codeCells = useNotebookStore
        .getState()
        .getNotebookForTab(TAB_ID)!
        .cells.filter((cell) => cell.kind === 'code');
      expect(codeCells).toHaveLength(2);
    });
    const codeCells = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.filter((cell) => cell.kind === 'code');
    expect(codeCells[1]).toMatchObject({ language: 'python' });
  });

  it('Run above uses the active cell instead of always targeting the last code cell', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
      stdout: [],
      stderr: [],
    });
    seedNotebookCells([
      {
        kind: 'code',
        id: 'cell-one',
        language: 'javascript',
        source: 'console.log(1)',
        outputs: [],
      },
      {
        kind: 'code',
        id: 'cell-two',
        language: 'javascript',
        source: 'console.log(2)',
        outputs: [],
      },
    ]);
    render(<NotebookView tabId={TAB_ID} />);

    screen.getAllByTestId('notebook-code-cell-source')[0]!.focus();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('notebook-toolbar-run-above'));

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

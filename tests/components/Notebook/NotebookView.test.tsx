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
  runnerManager: {
    execute: vi.fn(),
    stop: vi.fn(),
    // RL-043 Slice F (fold B) — the run hook probes this before a cold
    // Python run; default false keeps existing run tests on the warm path.
    needsInitialization: vi.fn(() => false),
  },
}));
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
}));
// RL-043 Slice (Monaco cells) — cells now host Monaco; jsdom needs the mock.
vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});

import { initI18n } from '../../../src/renderer/i18n';
import { NotebookView } from '../../../src/renderer/components/Notebook/NotebookView';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '../../../src/renderer/stores/notebookStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { runnerManager } from '../../../src/renderer/runners';
import type { NotebookCellV1 } from '../../../src/shared/notebook';
import {
  cellMockHarness,
  resetMonacoCellHarness,
  RUN_IN_PLACE_CHORD,
  RUN_ADVANCE_CHORD,
  RUN_INSERT_CHORD,
} from '../../__fixtures__/monacoEditorMock';

/**
 * RL-043 Slice (Monaco cells): a code cell is a static colorized view until
 * edited. This enters edit mode on the last code cell (mounting the mocked
 * Monaco, which captures the run keybind commands) and fires one.
 */
function runLastCodeCellKeybind(chord: number) {
  fireEvent.mouseDown(screen.getAllByTestId('notebook-code-cell-static').at(-1)!);
  act(() => {
    cellMockHarness.commands.get(chord)?.();
  });
}

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
    resetMonacoCellHarness();
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
    useUIStore.setState({ statusNotice: null });
    mockExecute.mockReset();
    await i18next.changeLanguage('en');
    useNotebookStore.getState().createNotebookForTab(TAB_ID, 'Hello');
  });
  afterEach(async () => {
    resetNotebookStoreForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({ statusNotice: null });
    localStorage.clear();
    await i18next.changeLanguage('en');
  });

  it('renders the notebook title + cells', () => {
    render(<NotebookView tabId={TAB_ID} />);
    const title = screen.getByTestId('notebook-title') as HTMLInputElement;
    expect(title.value).toBe('Hello');
    expect(screen.getAllByTestId(/^notebook-(code|markdown)-cell-row$/)).toHaveLength(2);
  });

  it('gives every cell-row action button the shared focus ring (UX Sweep T1)', () => {
    render(<NotebookView tabId={TAB_ID} />);
    for (const testId of [
      'notebook-code-cell-run',
      'notebook-code-cell-move-up',
      'notebook-code-cell-move-down',
      'notebook-code-cell-delete',
      'notebook-markdown-cell-toggle-edit',
      'notebook-markdown-cell-move-up',
      'notebook-markdown-cell-move-down',
      'notebook-markdown-cell-delete',
      'notebook-toolbar-run-all',
      'notebook-toolbar-stop',
      'notebook-toolbar-shortcuts',
    ]) {
      expect(screen.getByTestId(testId).className).toContain('focus-ring');
    }
  });


  it('gives the code-output collapse toggle the shared focus ring (UX Sweep T1)', () => {
    seedNotebookCells([
      {
        kind: 'code',
        id: 'cell-output',
        language: 'javascript',
        source: 'console.log(1)',
        outputs: [{ kind: 'text', stream: 'stdout', text: '1' }],
      },
    ]);
    render(<NotebookView tabId={TAB_ID} />);
    expect(screen.getByTestId('notebook-code-cell-output-toggle').className).toContain(
      'focus-ring'
    );
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
    // The new empty cell is a static view showing the language-aware
    // placeholder copy until it is edited.
    const lastStatic = screen.getAllByTestId('notebook-code-cell-static').at(-1)!;
    expect(lastStatic.textContent).toContain('Python');
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

  it('the cell language selector enables Python and switches to it (Slice F)', async () => {
    const telemetry = await import('../../../src/renderer/utils/telemetry');
    vi.mocked(telemetry.trackEvent).mockClear();
    render(<NotebookView tabId={TAB_ID} />);
    const select = screen.getByTestId('notebook-code-cell-language');
    const python = select.querySelector(
      'option[value="python"]'
    ) as HTMLOptionElement | null;
    expect(python).not.toBeNull();
    // RL-043 Slice F — Python now runs, so the option is no longer disabled.
    expect(python?.disabled).toBe(false);

    fireEvent.change(select, { target: { value: 'python' } });
    const codeCell = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.find((c) => c.kind === 'code')!;
    expect(codeCell.kind).toBe('code');
    if (codeCell.kind !== 'code') return;
    expect(codeCell.language).toBe('python');
    expect(telemetry.trackEvent).toHaveBeenCalledWith(
      'notebook.cell_language_changed',
      { to: 'python' }
    );
  });

  it('the export menu offers script + Jupyter .ipynb and the .ipynb action fires the export (RL-043 Slice D)', async () => {
    const telemetry = await import('../../../src/renderer/utils/telemetry');
    vi.mocked(telemetry.trackEvent).mockClear();
    // jsdom has no URL.createObjectURL — stub it so the blob download path
    // succeeds and the export reaches the telemetry call.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
      vi.fn();
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    // The seeded notebook has a code cell, so export is enabled.
    await user.click(screen.getByTestId('notebook-toolbar-export'));
    expect(screen.getByTestId('notebook-export-menu')).toBeTruthy();
    expect(screen.getByTestId('notebook-export-script')).toBeTruthy();
    await user.click(screen.getByTestId('notebook-export-ipynb'));
    expect(telemetry.trackEvent).toHaveBeenCalledWith('notebook.exported', {
      format: 'ipynb',
    });
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'notebook.notice.exportIpynbOk'
    );
    // The menu closes after an export action.
    expect(screen.queryByTestId('notebook-export-menu')).toBeNull();
  });

  it('the export menu offers .linguanb and it fires the lossless export (RL-043 Slice E)', async () => {
    const telemetry = await import('../../../src/renderer/utils/telemetry');
    vi.mocked(telemetry.trackEvent).mockClear();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    const user = userEvent.setup();
    render(<NotebookView tabId={TAB_ID} />);
    await user.click(screen.getByTestId('notebook-toolbar-export'));
    expect(screen.getByTestId('notebook-export-linguanb')).toBeTruthy();
    await user.click(screen.getByTestId('notebook-export-linguanb'));
    // Web build (no window.lingua.fs) falls back to the blob download.
    await waitFor(() => {
      expect(telemetry.trackEvent).toHaveBeenCalledWith('notebook.exported', {
        format: 'linguanb',
      });
    });
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'notebook.notice.exportLinguanbOk'
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
    runLastCodeCellKeybind(RUN_IN_PLACE_CHORD);
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
    runLastCodeCellKeybind(RUN_ADVANCE_CHORD);
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
    runLastCodeCellKeybind(RUN_INSERT_CHORD);
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByTestId('notebook-code-cell-row').length).toBe(
        before + 1
      )
    );
  });

  it('Shift+Enter runs a Python cell and appends a new cell preserving its language', async () => {
    mockExecute.mockResolvedValue({
      kind: 'ok',
      result: '',
      stdout: [{ args: ['hi'] }],
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

    fireEvent.mouseDown(
      screen.getAllByTestId('notebook-code-cell-static').at(-1)!
    );
    await act(async () => {
      cellMockHarness.commands.get(RUN_ADVANCE_CHORD)?.();
    });

    // RL-043 Slice F — Python runs now, so Shift+Enter executes the cell
    // through the python runner (it no longer no-ops on an unsupported
    // language) before appending the language-preserving cell below.
    expect(mockExecute).toHaveBeenCalledWith(
      'python',
      expect.any(String),
      expect.objectContaining({ language: 'python' })
    );
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

    // Activate the first code cell (the seed already selects it, but make the
    // intent explicit) so Run above targets the range through it. Use the
    // store action directly instead of relying on row focus timing: the full
    // suite can still have queued async focus updates from earlier notebook
    // tests, and this assertion is about the toolbar's active-cell target.
    act(() => {
      useNotebookStore.getState().setActiveCell(TAB_ID, 'cell-one');
    });
    const user = userEvent.setup();
    const runAboveButton = screen.getByTestId(
      'notebook-toolbar-run-above'
    ) as HTMLButtonElement;
    await waitFor(() => expect(runAboveButton.disabled).toBe(false));
    await user.click(runAboveButton);

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

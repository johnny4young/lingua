/**
 * Signal-Slate — Jupyter command/edit-mode keyboard UX coverage.
 *
 * Validates the new command-mode keyboard model layered onto the
 * notebook: Esc/Enter mode toggle, j/k navigation, a/b/dd/z structural
 * ops, m/y kind transform, and the new toolbar actions (restart kernel /
 * clear outputs / run from here / shortcuts legend). The run path is
 * mocked at the runner so these tests exercise wiring, not execution.
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
// implementation (Monaco cells) — cells host Monaco; jsdom needs the mock.
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
import { runnerManager } from '../../../src/renderer/runners';
import type { NotebookCellV1 } from '../../../src/shared/notebook';
import {
  cellMockHarness,
  resetMonacoCellHarness,
  ESCAPE_CHORD,
} from '../../__fixtures__/monacoEditorMock';

const mockExecute = runnerManager.execute as unknown as ReturnType<typeof vi.fn>;
const mockStop = runnerManager.stop as unknown as ReturnType<typeof vi.fn>;

const TAB_ID = 'tab-cmd';

function seed(cells: NotebookCellV1[], activeCellId = cells[0]?.id ?? null) {
  useNotebookStore.setState({
    notebooks: {
      [TAB_ID]: {
        notebook: {
          version: 1,
          id: 'notebook-cmd',
          title: 'Cmd',
          createdAt: '2026-05-27T00:00:00.000Z',
          cells,
        },
        cellRunStatus: {},
        cellDurationMs: {},
        cellVarFlow: {},
        executionCounter: 0,
        cellExecutionOrder: {},
        lastDeleted: null,
        activeCellId,
      },
    },
  });
}

function codeCell(id: string, source = ''): NotebookCellV1 {
  return { kind: 'code', id, language: 'javascript', source, outputs: [] };
}

function markdownCell(id: string, source = '# Note'): NotebookCellV1 {
  return { kind: 'markdown', id, source };
}

function shell(cellId: string): HTMLElement {
  return document.querySelector(
    `[data-cell-id="${cellId}"][data-notebook-cell-shell="true"]`
  ) as HTMLElement;
}

describe('<NotebookView /> command mode', () => {
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
          name: 'Cmd.linguanb',
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
    mockStop.mockReset();
    await i18next.changeLanguage('en');
  });
  afterEach(async () => {
    resetNotebookStoreForTests();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    localStorage.clear();
    await i18next.changeLanguage('en');
  });

  it('Esc in the cell editor drops to command mode (blur + shell focus)', async () => {
    seed([codeCell('c1'), codeCell('c2')]);
    render(<NotebookView tabId={TAB_ID} />);
    // Enter edit mode on c1 (mounts the mocked Monaco).
    fireEvent.mouseDown(screen.getAllByTestId('notebook-code-cell-static')[0]!);
    await waitFor(() =>
      expect(shell('c1').getAttribute('data-cell-mode')).toBe('edit')
    );
    // Monaco's Esc command (implementation note) routes to the row's command-mode drop.
    act(() => {
      cellMockHarness.commands.get(ESCAPE_CHORD)?.();
    });
    await waitFor(() =>
      expect(shell('c1').getAttribute('data-cell-mode')).toBe('command')
    );
  });

  it('Enter in command mode enters edit mode on the active cell', async () => {
    seed([codeCell('c1')]);
    render(<NotebookView tabId={TAB_ID} />);
    shell('c1').focus();
    fireEvent.keyDown(screen.getByTestId('notebook-cells'), { key: 'Enter' });
    // The cell mounts its editor (the mock renders the source textarea);
    // Monaco owns the real caret focus, untestable through the mock.
    await waitFor(() =>
      expect(screen.queryByTestId('notebook-code-cell-source')).toBeTruthy()
    );
    expect(shell('c1').getAttribute('data-cell-mode')).toBe('edit');
  });

  it('j / k navigate the active cell down / up', () => {
    seed([codeCell('c1'), codeCell('c2'), codeCell('c3')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    fireEvent.keyDown(cells, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c2');
    fireEvent.keyDown(cells, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c3');
    fireEvent.keyDown(cells, { key: 'k' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c2');
  });

  it('markdown cells participate in j / k navigation', () => {
    seed([codeCell('c1'), markdownCell('md1'), codeCell('c3')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    fireEvent.keyDown(cells, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('md1');
    fireEvent.keyDown(cells, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c3');
  });

  it('ArrowDown / ArrowUp also navigate in command mode', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    fireEvent.keyDown(cells, { key: 'ArrowDown' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c2');
    fireEvent.keyDown(cells, { key: 'ArrowUp' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c1');
  });

  it('a / b insert a code cell above / below the active cell', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    fireEvent.keyDown(cells, { key: 'a' });
    let ids = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    // New cell inserted before c1.
    expect(ids[1]).toBe('c1');
    expect(ids).toHaveLength(3);

    fireEvent.keyDown(cells, { key: 'b' });
    ids = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    expect(ids).toHaveLength(4);
  });

  it('dd (double-d) deletes the active cell; a single d does not', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    // Single d — no delete yet.
    fireEvent.keyDown(cells, { key: 'd' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells
    ).toHaveLength(2);
    // Second d within the window — delete.
    fireEvent.keyDown(cells, { key: 'd' });
    const remaining = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    expect(remaining).toEqual(['c2']);
  });

  it('an intervening keystroke breaks the dd chord (no accidental delete)', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    // Arm the chord, then navigate, then press d again within the window.
    // The intervening `j` must reset the chord, so this second `d` only
    // re-arms rather than deleting the now-different active cell.
    fireEvent.keyDown(cells, { key: 'd' });
    fireEvent.keyDown(cells, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c2');
    fireEvent.keyDown(cells, { key: 'd' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells
    ).toHaveLength(2);
    // A genuine second d completes the (re-armed) chord on c2.
    fireEvent.keyDown(cells, { key: 'd' });
    const remaining = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    expect(remaining).toEqual(['c1']);
  });

  it('z restores the most-recently deleted cell', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    fireEvent.keyDown(cells, { key: 'd' });
    fireEvent.keyDown(cells, { key: 'd' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells
    ).toHaveLength(1);
    fireEvent.keyDown(cells, { key: 'z' });
    const ids = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('m transforms a code cell to markdown; y transforms back to code', () => {
    seed([codeCell('c1', 'console.log(1)')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const cells = screen.getByTestId('notebook-cells');
    fireEvent.keyDown(cells, { key: 'm' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells[0]!.kind
    ).toBe('markdown');
    fireEvent.keyDown(cells, { key: 'y' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells[0]!.kind
    ).toBe('code');
  });

  it('Ctrl+C interrupts a running kernel', () => {
    seed([codeCell('c1')], 'c1');
    useNotebookStore.getState().setCellRunStatus(TAB_ID, 'c1', 'running');
    render(<NotebookView tabId={TAB_ID} />);
    fireEvent.keyDown(screen.getByTestId('notebook-cells'), {
      key: 'c',
      ctrlKey: true,
    });
    expect(mockStop).toHaveBeenCalledWith('javascript');
  });

  it('Ctrl+ArrowDown moves the active cell down', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    fireEvent.keyDown(screen.getByTestId('notebook-cells'), {
      key: 'ArrowDown',
      ctrlKey: true,
    });
    const ids = useNotebookStore
      .getState()
      .getNotebookForTab(TAB_ID)!
      .cells.map((c) => c.id);
    expect(ids).toEqual(['c2', 'c1']);
  });

  it('does not fire command keybinds while typing in a textarea', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    // Enter edit mode on c1 so the editor's textarea is the keydown target.
    fireEvent.mouseDown(screen.getAllByTestId('notebook-code-cell-static')[0]!);
    const textarea = screen.getByTestId('notebook-code-cell-source');
    textarea.focus();
    // `j` typed in the textarea must NOT move the active cell.
    fireEvent.keyDown(textarea, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c1');
    // `d` must NOT delete.
    fireEvent.keyDown(textarea, { key: 'd' });
    fireEvent.keyDown(textarea, { key: 'd' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells
    ).toHaveLength(2);
  });

  it('does not fire command keybinds while the cell language selector is focused ', () => {
    seed([codeCell('c1'), codeCell('c2')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    const select = screen.getAllByTestId('notebook-code-cell-language')[0]!;
    select.focus();
    // Option type-ahead ('j') must NOT move the active cell, and 'dd' must
    // NOT delete — the selector is an editable surface like the textarea.
    fireEvent.keyDown(select, { key: 'j' });
    expect(useNotebookStore.getState().getActiveCellId(TAB_ID)).toBe('c1');
    fireEvent.keyDown(select, { key: 'd' });
    fireEvent.keyDown(select, { key: 'd' });
    expect(
      useNotebookStore.getState().getNotebookForTab(TAB_ID)!.cells
    ).toHaveLength(2);
  });

  it('shows the Jupyter [N] execution-order stamp after a run', () => {
    seed([codeCell('c1')], 'c1');
    useNotebookStore.getState().setCellExecutionOrder(TAB_ID, 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    expect(
      screen.getByTestId('notebook-code-cell-execution-order').textContent
    ).toContain('1');
  });

  describe('toolbar actions', () => {
    it('Restart kernel clears outputs + resets execution counter', async () => {
      seed([codeCell('c1')], 'c1');
      useNotebookStore.getState().setCellOutputs(TAB_ID, 'c1', [
        { kind: 'text', stream: 'stdout', text: 'hi' },
      ]);
      useNotebookStore.getState().setCellExecutionOrder(TAB_ID, 'c1');
      const user = userEvent.setup();
      render(<NotebookView tabId={TAB_ID} />);
      await user.click(screen.getByTestId('notebook-toolbar-restart'));
      const nb = useNotebookStore.getState().getNotebookForTab(TAB_ID)!;
      expect(nb.cells[0]).toMatchObject({ outputs: [] });
      expect(
        useNotebookStore.getState().getCellExecutionOrder(TAB_ID, 'c1')
      ).toBeNull();
    });

    it('Clear outputs empties every code cell output but keeps cells', async () => {
      seed([codeCell('c1'), codeCell('c2')], 'c1');
      useNotebookStore.getState().setCellOutputs(TAB_ID, 'c1', [
        { kind: 'text', stream: 'stdout', text: 'a' },
      ]);
      const user = userEvent.setup();
      render(<NotebookView tabId={TAB_ID} />);
      await user.click(screen.getByTestId('notebook-toolbar-clear-outputs'));
      const nb = useNotebookStore.getState().getNotebookForTab(TAB_ID)!;
      expect(nb.cells).toHaveLength(2);
      expect(nb.cells[0]).toMatchObject({ outputs: [] });
    });

    it('Run from here runs the active cell + cells below', async () => {
      mockExecute.mockResolvedValue({
        kind: 'ok',
        structuredResult: { stdout: [], stderr: [], sessionDelta: {} },
        stdout: [],
        stderr: [],
      });
      seed(
        [
          codeCell('c1', 'console.log(1)'),
          codeCell('c2', 'console.log(2)'),
          codeCell('c3', 'console.log(3)'),
        ],
        'c2'
      );
      const user = userEvent.setup();
      render(<NotebookView tabId={TAB_ID} />);
      await user.click(screen.getByTestId('notebook-toolbar-run-from-here'));
      // c2 + c3 — two runs, not c1.
      await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(2));
    });

    it('toggles the keyboard shortcuts legend', async () => {
      seed([codeCell('c1')], 'c1');
      const user = userEvent.setup();
      render(<NotebookView tabId={TAB_ID} />);
      expect(screen.queryByTestId('notebook-shortcuts-legend')).toBeNull();
      await user.click(screen.getByTestId('notebook-toolbar-shortcuts'));
      expect(screen.getByTestId('notebook-shortcuts-legend')).toBeTruthy();
    });
  });

  it('renders ES command-mode mode label when language is es', async () => {
    await i18next.changeLanguage('es');
    seed([codeCell('c1')], 'c1');
    render(<NotebookView tabId={TAB_ID} />);
    // Active cell shows the Command-mode label in Spanish.
    expect(screen.getByTestId('notebook-cell-mode').textContent).toContain(
      'Modo comando'
    );
  });
});

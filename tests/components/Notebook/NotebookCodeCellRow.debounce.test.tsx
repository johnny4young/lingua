/**
 * PERF-003 / PERF-004 — notebook code-cell source auto-save debounce.
 *
 * The code cell keeps its source in local React state and only writes
 * through the persisted `notebookStore` (`onSourceChange`) after a quiet
 * window, exactly like `SqlQueryEditor` / `HttpRequestEditor`. These
 * tests pin that contract:
 *
 *   - a keystroke does NOT persist immediately;
 *   - it persists once after the debounce settles (one call, latest text);
 *   - a pending edit flushes on unmount;
 *   - switching the row to a different cell flushes the previous cell's
 *     pending edit onto the cell it was typed into (never the new one).
 *
 * RL-043 Slice (Monaco cells): the editor surface is now Monaco. The
 * `@monaco-editor/react` mock renders a `notebook-code-cell-source`
 * textarea while editing, so these tests first click the static cell to
 * enter edit mode, then drive the same draft/flush contract through it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCodeCellRow } from '../../../src/renderer/components/Notebook/NotebookCodeCellRow';
import { getNotebookCellAutoSaveDebounceMs } from '../../../src/renderer/components/Notebook/notebookCellEditorTiming';
import type { NotebookCodeCellV1 } from '../../../src/shared/notebook';
import {
  cellMockHarness,
  resetMonacoCellHarness,
  RUN_IN_PLACE_CHORD,
} from '../../__fixtures__/monacoEditorMock';

vi.mock('@monaco-editor/react', async () => {
  const m = await import('../../__fixtures__/monacoEditorMock');
  return m.makeMonacoEditorMock();
});

function makeCell(overrides: Partial<NotebookCodeCellV1> = {}): NotebookCodeCellV1 {
  return {
    kind: 'code',
    id: 'cell-a',
    language: 'javascript',
    source: '',
    outputs: [],
    ...overrides,
  };
}

function rowProps(
  cell: NotebookCodeCellV1,
  onSourceChange: (cellId: string, source: string) => void,
  extra: Record<string, unknown> = {}
) {
  return {
    cell,
    cellIndex: 0,
    status: 'idle' as const,
    isActive: true,
    canMoveUp: false,
    canMoveDown: false,
    disabled: false,
    onActivate: vi.fn(),
    onSourceChange,
    onRunCell: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onDelete: vi.fn(),
    onLanguageChange: vi.fn(),
    ...extra,
  };
}

/** Click the static cell view to mount the Monaco editor (edit mode). */
function enterEdit() {
  fireEvent.mouseDown(screen.getByTestId('notebook-code-cell-static'));
}

const DEBOUNCE_MS = getNotebookCellAutoSaveDebounceMs();

describe('NotebookCodeCellRow — source auto-save debounce', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    resetMonacoCellHarness();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not persist on a keystroke and persists once after the debounce settles', () => {
    const onSourceChange = vi.fn();
    render(<NotebookCodeCellRow {...rowProps(makeCell({ source: '' }), onSourceChange)} />);
    enterEdit();

    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: 'console.log(1)' },
    });

    expect(onSourceChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', 'console.log(1)');
  });

  it('collapses rapid edits into a single persist of the latest text', () => {
    const onSourceChange = vi.fn();
    render(<NotebookCodeCellRow {...rowProps(makeCell({ source: '' }), onSourceChange)} />);
    enterEdit();

    const textarea = screen.getByTestId('notebook-code-cell-source');
    fireEvent.change(textarea, { target: { value: 'a' } });
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS - 100));
    fireEvent.change(textarea, { target: { value: 'ab' } });
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS - 100));
    fireEvent.change(textarea, { target: { value: 'abc' } });

    expect(onSourceChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', 'abc');
  });

  it('flushes the latest draft on unmount before the debounce settles', () => {
    const onSourceChange = vi.fn();
    const { unmount } = render(
      <NotebookCodeCellRow {...rowProps(makeCell({ source: '' }), onSourceChange)} />
    );
    enterEdit();

    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: 'late()' },
    });

    unmount();

    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', 'late()');
  });

  it('flushes the latest draft before a run keybind so the run sees fresh source', () => {
    const onSourceChange = vi.fn();
    const onRunCell = vi.fn();
    render(
      <NotebookCodeCellRow
        {...rowProps(makeCell({ source: '' }), onSourceChange, { onRunCell })}
      />
    );
    enterEdit();

    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: '1 + 1' },
    });
    // Cmd/Ctrl+Enter <debounce after the last keystroke must flush first.
    act(() => cellMockHarness.commands.get(RUN_IN_PLACE_CHORD)?.());

    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', '1 + 1');
    expect(onRunCell).toHaveBeenCalledWith('cell-a');
  });

  it('flushes a pending edit onto the cell it was typed into when the row rebinds to another cell', () => {
    const onSourceChange = vi.fn();
    const { rerender } = render(
      <NotebookCodeCellRow
        {...rowProps(makeCell({ id: 'cell-a', source: '' }), onSourceChange)}
      />
    );
    enterEdit();

    // Type into cell-a but do NOT let the debounce settle.
    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: 'from-a' },
    });

    // Rebind the row to a different cell inside the quiet window.
    rerender(
      <NotebookCodeCellRow
        {...rowProps(makeCell({ id: 'cell-b', source: 'b-source' }), onSourceChange)}
      />
    );

    // The rebind flushed cell-a's pending edit, addressed to cell-a.
    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', 'from-a');

    // Draining any residual timer must not produce a write onto cell-b.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange.mock.calls.some(([id]) => id === 'cell-b')).toBe(false);
  });
});

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
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCodeCellRow } from '../../../src/renderer/components/Notebook/NotebookCodeCellRow';
import { getNotebookCellAutoSaveDebounceMs } from '../../../src/renderer/components/Notebook/notebookCellEditorTiming';
import type { NotebookCodeCellV1 } from '../../../src/shared/notebook';

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

function renderRow(
  cell: NotebookCodeCellV1,
  onSourceChange: (cellId: string, source: string) => void
) {
  return render(
    <NotebookCodeCellRow
      cell={cell}
      cellIndex={0}
      status="idle"
      canMoveUp={false}
      canMoveDown={false}
      disabled={false}
      onSourceChange={onSourceChange}
      onRunCell={vi.fn()}
      onMoveUp={vi.fn()}
      onMoveDown={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

const DEBOUNCE_MS = getNotebookCellAutoSaveDebounceMs();

describe('NotebookCodeCellRow — source auto-save debounce', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not persist on a keystroke and persists once after the debounce settles', () => {
    const onSourceChange = vi.fn();
    renderRow(makeCell({ source: '' }), onSourceChange);

    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: 'console.log(1)' },
    });

    // The keystroke writes only local state — the persisted store is
    // untouched until the quiet window elapses.
    expect(onSourceChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', 'console.log(1)');
  });

  it('collapses rapid edits into a single persist of the latest text', () => {
    const onSourceChange = vi.fn();
    renderRow(makeCell({ source: '' }), onSourceChange);

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
    const { unmount } = renderRow(makeCell({ source: '' }), onSourceChange);

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
        cell={makeCell({ source: '' })}
        cellIndex={0}
        status="idle"
        canMoveUp={false}
        canMoveDown={false}
        disabled={false}
        onSourceChange={onSourceChange}
        onRunCell={onRunCell}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const textarea = screen.getByTestId('notebook-code-cell-source');
    fireEvent.change(textarea, { target: { value: '1 + 1' } });
    // Cmd+Enter <debounce after the last keystroke must flush first.
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    expect(onSourceChange).toHaveBeenCalledTimes(1);
    expect(onSourceChange).toHaveBeenLastCalledWith('cell-a', '1 + 1');
    expect(onRunCell).toHaveBeenCalledWith('cell-a');
  });

  it('flushes a pending edit onto the cell it was typed into when the row rebinds to another cell', () => {
    const onSourceChange = vi.fn();
    const { rerender } = renderRow(makeCell({ id: 'cell-a', source: '' }), onSourceChange);

    // Type into cell-a but do NOT let the debounce settle.
    fireEvent.change(screen.getByTestId('notebook-code-cell-source'), {
      target: { value: 'from-a' },
    });

    // Rebind the row to a different cell inside the quiet window.
    rerender(
      <NotebookCodeCellRow
        cell={makeCell({ id: 'cell-b', source: 'b-source' })}
        cellIndex={0}
        status="idle"
        canMoveUp={false}
        canMoveDown={false}
        disabled={false}
        onSourceChange={onSourceChange}
        onRunCell={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onDelete={vi.fn()}
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

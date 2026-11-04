import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SqlVirtualGrid, type SqlGridCell, type SqlGridEditing } from '../../../src/renderer/components/SqlWorkspace/SqlVirtualGrid';

const makeColumns = (count: number) => Array.from({ length: count }, (_, c) => ({ name: `c${c}`, type: 'Utf8' }));
const makeRows = (count: number, columns: number) =>
  Array.from({ length: count }, (_, r) => Object.fromEntries(Array.from({ length: columns }, (_, c) => [`c${c}`, `r${r}c${c}`])));

function Grid({ columnCount, editing, rows }: { columnCount: number; editing?: SqlGridEditing; rows?: ReadonlyArray<Record<string, unknown>> }) {
  const [selected, setSelected] = useState<SqlGridCell | null>(null);
  const [columns] = useState(() => makeColumns(columnCount));
  const [ownRows] = useState(() => makeRows(3, columnCount));
  return (
    <SqlVirtualGrid
      columns={columns}
      rows={rows ?? ownRows}
      sort={{ column: null, direction: 'asc' }}
      onSort={vi.fn()}
      selected={selected}
      onSelect={setSelected}
      onCellAction={vi.fn()}
      onCopyRow={vi.fn()}
      {...(editing ? { editing } : {})}
    />
  );
}

const container = () => screen.getByTestId('sql-result-preview-table-container');
const table = () => screen.getByTestId('sql-result-preview-table') as HTMLTableElement;
const row = (index: number) => screen.getAllByTestId('sql-result-preview-row')[index]!;
const cellsOf = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>('td[role="gridcell"]')];
const columnIndexes = (element: HTMLElement) => cellsOf(element).map((td) => Number(td.getAttribute('aria-colindex')));
const scrollSideways = (left: number) => {
  container().scrollLeft = left;
  fireEvent.scroll(container());
};
const cell = (element: HTMLElement, column: string) => element.querySelector<HTMLElement>(`td[data-column="${column}"]`);
/** jsdom has no layout: give the header cells and the viewport real geometry. */
const stubGeometry = (columnWidth: number, viewportWidth: number) => {
  Object.defineProperty(container(), 'clientWidth', { configurable: true, value: viewportWidth });
  [...table().tHead!.rows[0]!.cells].forEach((th, c) => {
    Object.defineProperty(th, 'offsetLeft', { configurable: true, value: c * columnWidth });
    Object.defineProperty(th, 'offsetWidth', { configurable: true, value: columnWidth });
  });
};

describe('column windowing', () => {
  it('keeps auto layout and every cell at 30 columns', () => {
    render(<Grid columnCount={30} />);
    expect(table().className).toContain('w-max');
    expect(table().className).not.toContain('table-fixed');
    expect(table().querySelector('colgroup')).toBeNull();
    expect(columnIndexes(row(0))).toEqual(Array.from({ length: 30 }, (_, c) => c + 1));
    expect(row(0).querySelector('td[aria-hidden="true"]')).toBeNull();
  });

  it('mounts only the columns on screen at 31 columns, with fixed widths and a full header', () => {
    render(<Grid columnCount={31} />);
    expect(table().className).toContain('table-fixed');
    expect(table().className).not.toContain('w-max');
    const cols = [...table().querySelectorAll('col')];
    expect(cols).toHaveLength(31);
    expect(parseInt(table().style.width, 10)).toBe(cols.reduce((sum, col) => sum + parseInt(col.style.width, 10), 0));
    expect(table().getAttribute('aria-colcount')).toBe('31');

    const headers = [...table().tHead!.rows[0]!.cells];
    expect(headers).toHaveLength(31);
    expect(headers.map((th) => Number(th.getAttribute('aria-colindex')))).toEqual(Array.from({ length: 31 }, (_, c) => c + 1));

    const mounted = columnIndexes(row(0));
    expect(mounted[0]).toBe(1);
    expect(mounted.length).toBeLessThan(15);
    const gap = row(0).querySelector<HTMLTableCellElement>('td[aria-hidden="true"]')!;
    expect(gap.getAttribute('role')).toBe('presentation');
    expect(gap.colSpan).toBe(31 - mounted.length);
    expect(gap.dataset.column).toBeUndefined();
  });

  it('moves the window on horizontal scroll and leaves the header alone', () => {
    render(<Grid columnCount={100} />);
    const headerCell = table().tHead!.rows[0]!.cells[50]!;
    scrollSideways(50 * 200);
    const mounted = columnIndexes(row(0));
    expect(mounted).toContain(51);
    expect(mounted).not.toContain(1);
    expect(mounted.length).toBeLessThan(20);
    const gaps = [...row(0).querySelectorAll<HTMLTableCellElement>('td[aria-hidden="true"]')];
    expect(gaps).toHaveLength(2);
    expect(gaps[0]!.colSpan + mounted.length + gaps[1]!.colSpan).toBe(100);
    expect(cell(row(0), 'c50')!.textContent).toBe('r0c50');
    expect(table().tHead!.rows[0]!.cells[50]).toBe(headerCell);
  });

  it('keeps widths when the rows change under the same columns', () => {
    const rows = makeRows(3, 40);
    const { rerender } = render(<Grid columnCount={40} rows={rows} />);
    const widths = () => [...table().querySelectorAll('col')].map((col) => col.style.width);
    const before = widths();
    rerender(<Grid columnCount={40} rows={[{ ...rows[0], c1: 'x'.repeat(300) }]} />);
    expect(widths()).toEqual(before);
  });

  it('keeps a focused sort button when its column scrolls out of the body window', () => {
    render(<Grid columnCount={100} />);
    const button = table().tHead!.rows[0]!.cells[0]!.querySelector('button')!;
    button.focus();
    scrollSideways(50 * 200);
    expect(document.activeElement).toBe(button);
  });
});

describe('arrow keys past the viewport', () => {
  it.each([
    ['windowed', 100],
    ['auto layout', 30],
  ])('scrolls the selected cell into view, %s', async (_label, columnCount) => {
    const user = userEvent.setup();
    render(<Grid columnCount={columnCount} />);
    stubGeometry(200, 800);
    await user.click(cell(row(0), 'c0')!);
    container().focus();
    for (let press = 0; press < 10; press++) await user.keyboard('{ArrowRight}');
    expect(container().scrollLeft).toBe(11 * 200 - 800);
    const selected = cell(row(0), 'c10')!;
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.getAttribute('aria-colindex')).toBe('11');
    for (let press = 0; press < 10; press++) await user.keyboard('{ArrowLeft}');
    expect(container().scrollLeft).toBe(0);
    expect(cell(row(0), 'c0')!.getAttribute('aria-selected')).toBe('true');
  });

  it('brings a selection scrolled far away back when the keyboard moves it', async () => {
    const user = userEvent.setup();
    render(<Grid columnCount={100} />);
    stubGeometry(200, 800);
    await user.click(cell(row(0), 'c1')!);
    scrollSideways(60 * 200);
    expect(cell(row(0), 'c1')).toBeNull();
    container().focus();
    await user.keyboard('{ArrowDown}');
    expect(container().scrollLeft).toBe(200);
    expect(cell(row(1), 'c1')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('inline editor in a windowed row', () => {
  const editable = (onEditCell = vi.fn()): SqlGridEditing => ({ canEdit: () => true, onEditCell });

  it('stays mounted and focused when its column scrolls away, in that row only', async () => {
    const user = userEvent.setup();
    const onEditCell = vi.fn();
    render(<Grid columnCount={100} editing={editable(onEditCell)} />);
    await user.dblClick(cell(row(0), 'c1')!);
    const input = screen.getByTestId('sql-cell-editor') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'draft');
    scrollSideways(60 * 200);
    expect(screen.getByTestId('sql-cell-editor')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.closest('td')!.getAttribute('aria-colindex')).toBe('2');
    expect(row(0).querySelectorAll('td[aria-hidden="true"]')).toHaveLength(3);
    expect(cell(row(1), 'c1')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onEditCell).toHaveBeenCalledWith(expect.anything(), 'c1', 'draft');
    expect(screen.queryByTestId('sql-cell-editor')).toBeNull();
    expect(cell(row(0), 'c1')).toBeNull();
  });

  it('cancels with Escape after scrolling away', async () => {
    const user = userEvent.setup();
    const onEditCell = vi.fn();
    render(<Grid columnCount={100} editing={editable(onEditCell)} />);
    await user.dblClick(cell(row(0), 'c1')!);
    scrollSideways(60 * 200);
    await user.keyboard('{Escape}');
    expect(onEditCell).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sql-cell-editor')).toBeNull();
    expect(document.activeElement).toBe(container());
  });

  it('opens on a selected cell that is scrolled out of the window', async () => {
    const user = userEvent.setup();
    render(<Grid columnCount={100} editing={editable()} />);
    await user.click(cell(row(0), 'c1')!);
    scrollSideways(60 * 200);
    act(() => container().focus());
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByTestId('sql-cell-editor'));
  });
});

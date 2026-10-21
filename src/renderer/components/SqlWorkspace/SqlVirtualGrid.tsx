/**
 * Virtualized result grid: fixed 26 px rows, only the visible ones mounted,
 * a sticky typed header, cell selection with the arrow keys, a cell menu, and
 * foreign-key cells that link to the referenced row.
 */

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { cn } from '../../utils/cn';
import { fixedRowWindow } from './sqlResultFilters';
import { renderCell } from './sqlResultFormatters';
import type { SqlSortState } from './sqlResultGrid';

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

export interface SqlGridCell {
  row: number;
  column: string;
}

export type SqlCellAction = 'filter' | 'exclude' | 'copy-value' | 'copy-row' | 'copy-insert' | 'open-value';

const CELL_ACTIONS: ReadonlyArray<{ id: SqlCellAction; labelKey: string }> = [
  { id: 'filter', labelKey: 'sqlWorkspace.grid.menu.filter' },
  { id: 'exclude', labelKey: 'sqlWorkspace.grid.menu.exclude' },
  { id: 'copy-value', labelKey: 'sqlWorkspace.grid.menu.copyValue' },
  { id: 'copy-row', labelKey: 'sqlWorkspace.grid.menu.copyRow' },
  { id: 'copy-insert', labelKey: 'sqlWorkspace.grid.menu.copyInsert' },
  { id: 'open-value', labelKey: 'sqlWorkspace.grid.menu.openValue' },
];

/** Numbers right-aligned in the number color, null italic and subtle, the rest in the base text color. */
function cellClass(value: unknown, numeric: boolean): string {
  const base = 'max-w-[32rem] truncate px-2.5 align-middle';
  if (value === null || value === undefined) return `${base} italic text-fg-subtle ${numeric ? 'text-right' : ''}`;
  if (numeric) return `${base} text-right tabular-nums text-syntax-number`;
  if (typeof value === 'boolean') return `${base} text-syntax-keyword`;
  return `${base} text-fg-base`;
}

export function SqlVirtualGrid({
  columns,
  rows,
  sort,
  onSort,
  selected,
  onSelect,
  onCellAction,
  onCopyRow,
  linkedColumns,
  onFollowLink,
}: {
  columns: ReadonlyArray<SqlColumnMetadata>;
  rows: ReadonlyArray<Record<string, unknown>>;
  sort: SqlSortState;
  onSort: (column: string) => void;
  selected: SqlGridCell | null;
  onSelect: (cell: SqlGridCell | null) => void;
  onCellAction: (action: SqlCellAction, cell: SqlGridCell) => void;
  onCopyRow: (row: number) => void;
  /** Foreign-key columns; their non-null cells link to the referenced row. */
  linkedColumns?: ReadonlySet<string>;
  onFollowLink?: (column: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [menu, setMenu] = useState<{ cell: SqlGridCell; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const typed = useMemo(
    () =>
      columns.map((col) => {
        const duckType = arrowTypeToDuckDb(col.type);
        return { col, duckType, numeric: isNumericSqlType(duckType) };
      }),
    [columns]
  );

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => setViewport({ scrollTop: node.scrollTop, height: node.clientHeight });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const slice = fixedRowWindow({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    overscan: OVERSCAN,
  });

  // Keep the selected cell in view as the arrow keys move it.
  const revealRow = (row: number) => {
    const node = scrollRef.current;
    if (!node) return;
    const top = row * ROW_HEIGHT;
    const headerHeight = 28;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + ROW_HEIGHT > node.scrollTop + node.clientHeight - headerHeight) {
      node.scrollTop = top + ROW_HEIGHT - node.clientHeight + headerHeight;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0 || typed.length === 0) return;
    const current = selected ?? { row: -1, column: typed[0]!.col.name };
    const colIndex = Math.max(0, typed.findIndex(({ col }) => col.name === current.column));
    const move = (row: number, col: number) => {
      const next = { row: Math.min(rows.length - 1, Math.max(0, row)), column: typed[Math.min(typed.length - 1, Math.max(0, col))]!.col.name };
      onSelect(next);
      revealRow(next.row);
    };
    if (event.key === 'ArrowDown') move(current.row + 1, colIndex);
    else if (event.key === 'ArrowUp') move(current.row < 0 ? 0 : current.row - 1, colIndex);
    else if (event.key === 'ArrowRight' && selected) move(current.row, colIndex + 1);
    else if (event.key === 'ArrowLeft' && selected) move(current.row, colIndex - 1);
    else if (event.key === 'Enter' && selected) onCellAction('open-value', selected);
    else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && selected) {
      const rect = scrollRef.current?.getBoundingClientRect();
      setMenu({ cell: selected, x: (rect?.left ?? 0) + 40, y: (rect?.top ?? 0) + 40 });
    } else {
      const isCopy = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c';
      // A text selection in the grid copies as text, the platform default.
      if (isCopy && selected && (globalThis.getSelection?.()?.toString() ?? '') === '') onCopyRow(selected.row);
      else return;
    }
    event.preventDefault();
  };

  const openMenu = (event: MouseEvent, cell: SqlGridCell) => {
    event.preventDefault();
    onSelect(cell);
    setMenu({ cell, x: event.clientX, y: event.clientY });
  };

  return (
    <div
      ref={scrollRef}
      data-testid="sql-result-preview-table-container"
      tabIndex={rows.length > 0 ? 0 : undefined}
      aria-label={t('sqlWorkspace.grid.ariaLabel')}
      onKeyDown={handleKeyDown}
      onScroll={(event) => setViewport({ scrollTop: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
      className="min-h-[6.5rem] flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <table
        data-testid="sql-result-preview-table"
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={typed.length}
        className="w-max border-collapse font-mono text-caption"
      >
        <thead className="sticky top-0 z-10 bg-bg-panel">
          <tr aria-rowindex={1}>
            {typed.map(({ col, duckType, numeric }) => {
              const isSorted = sort.column === col.name;
              return (
                <th
                  key={col.name}
                  scope="col"
                  aria-sort={isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`h-7 whitespace-nowrap border-b border-border-subtle p-0 font-normal ${numeric ? 'min-w-[8.125rem]' : 'min-w-[12.5rem]'}`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.name)}
                    data-testid="sql-result-preview-sort"
                    data-column={col.name}
                    data-sort={isSorted ? sort.direction : 'none'}
                    title={t('sqlWorkspace.grid.sortBy', { name: col.name })}
                    className={`flex w-full items-center gap-1.5 overflow-hidden px-2.5 py-1.5 transition-colors hover:bg-bg-panel-alt/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 ${numeric ? 'justify-end text-right' : 'text-left'}`}
                  >
                    <span className="shrink-0 text-fg-subtle">{col.name}</span>
                    <span
                      data-testid="sql-result-preview-type"
                      className="min-w-0 truncate text-micro tracking-[0.04em] text-fg-subtle/70"
                      title={t('sqlWorkspace.grid.arrowType', { type: col.type })}
                    >
                      {linkedColumns?.has(col.name) ? `${duckType} · FK` : duckType}
                    </span>
                    {isSorted ? (
                      sort.direction === 'asc' ? (
                        <ArrowUp size={10} aria-hidden="true" className="shrink-0 text-fg-base" />
                      ) : (
                        <ArrowDown size={10} aria-hidden="true" className="shrink-0 text-fg-base" />
                      )
                    ) : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {slice.top > 0 ? <tr aria-hidden="true" style={{ height: slice.top }} /> : null}
          {rows.slice(slice.start, slice.end + 1).map((row, offset) => {
            const index = slice.start + offset;
            const rowSelected = selected?.row === index;
            return (
              <tr
                key={index}
                aria-rowindex={index + 2}
                data-testid="sql-result-preview-row"
                aria-selected={rowSelected}
                data-selected={rowSelected ? 'true' : undefined}
                onClick={(event) => {
                  const column =
                    (event.target as HTMLElement).closest('td')?.dataset.column ?? selected?.column ?? typed[0]?.col.name;
                  if (column) onSelect({ row: index, column });
                }}
                className={`h-[26px] border-b border-border-subtle ${rowSelected ? 'bg-editor-line-hl' : 'hover:bg-bg-panel-alt/60'}`}
              >
                {typed.map(({ col, numeric }) => {
                  const value = row[col.name];
                  const isNull = value === null || value === undefined;
                  const cellSelected = rowSelected && selected?.column === col.name;
                  const linked = !isNull && linkedColumns?.has(col.name) === true && onFollowLink !== undefined;
                  return (
                    <td
                      key={col.name}
                      role="gridcell"
                      aria-selected={cellSelected}
                      data-column={col.name}
                      data-null={isNull ? 'true' : undefined}
                      onDoubleClick={() => onCellAction('open-value', { row: index, column: col.name })}
                      onContextMenu={(event) => openMenu(event, { row: index, column: col.name })}
                      className={cn(cellClass(value, numeric), cellSelected && 'outline outline-1 -outline-offset-1 outline-accent')}
                    >
                      {linked ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          data-testid="sql-result-fk-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            onFollowLink(col.name, value);
                          }}
                          className="text-accent-fg underline underline-offset-2 hover:text-accent"
                        >
                          {renderCell(value)} →
                        </button>
                      ) : (
                        renderCell(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {slice.bottom > 0 ? <tr aria-hidden="true" style={{ height: slice.bottom }} /> : null}
        </tbody>
      </table>
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-testid="sql-cell-menu"
              style={{ position: 'fixed', left: Math.min(menu.x, globalThis.innerWidth - 220), top: Math.min(menu.y, globalThis.innerHeight - 190) }}
              className="z-50 w-[210px] rounded-lg border border-border-default bg-bg-panel p-1 text-body-sm shadow-lg"
            >
              {CELL_ACTIONS.map(({ id, labelKey }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  data-testid={`sql-cell-menu-${id}`}
                  onClick={() => {
                    setMenu(null);
                    onCellAction(id, menu.cell);
                  }}
                  className="flex h-[26px] w-full items-center rounded px-2 text-left text-fg-base hover:bg-bg-panel-alt focus-visible:bg-bg-panel-alt focus-visible:outline-none"
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

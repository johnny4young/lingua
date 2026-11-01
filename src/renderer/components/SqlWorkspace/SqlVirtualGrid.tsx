/**
 * Virtualized result grid: fixed 26 px rows, only the visible ones mounted,
 * a sticky typed header, cell selection with the arrow keys, a cell menu, and
 * foreign-key cells that link to the referenced row.
 */

import { ArrowDown, ArrowUp } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { cn } from '../../utils/cn';
import { fixedRowWindow } from './sqlResultFilters';
import { renderCell } from './sqlResultFormatters';
import { cellMagic, fractionColumns, type SqlCellMagic } from './sqlCellMagic';
import type { SqlSortState } from './sqlResultGrid';
import { cellText, cellTone, DELETED, type CellTone, type ShownRow } from './sqlRowEditModel';
import '../../i18n/sqlConnectionsCatalog';

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

export interface SqlGridCell {
  row: number;
  column: string;
}

export type SqlCellAction = 'filter' | 'exclude' | 'copy-value' | 'copy-row' | 'copy-insert' | 'open-value' | 'set-null' | 'delete-row' | 'duplicate-row';

/** Staged editing of an Explorer table's rows. */
export interface SqlGridEditing {
  canEdit: (row: Record<string, unknown>, column: string) => boolean;
  /** The row as it was when the editor opened, so a reorder underneath cannot move the value. */
  onEditCell: (row: Record<string, unknown>, column: string, value: string) => void;
}

const EDIT_ACTIONS: ReadonlyArray<{ id: SqlCellAction | 'edit-cell'; labelKey: string }> = [
  { id: 'edit-cell', labelKey: 'sqlWorkspace.edits.menu.edit' },
  { id: 'set-null', labelKey: 'sqlWorkspace.edits.menu.setNull' },
  { id: 'duplicate-row', labelKey: 'sqlWorkspace.edits.menu.duplicate' },
  { id: 'delete-row', labelKey: 'sqlWorkspace.edits.menu.delete' },
];

const TONE_CLASS: Readonly<Record<CellTone, string>> = {
  edited: 'bg-warning-bg text-warning-fg',
  deleted: 'text-error-fg line-through',
  inserted: 'bg-accent-tint',
};

const CELL_ACTIONS: ReadonlyArray<{ id: SqlCellAction; labelKey: string }> = [
  { id: 'filter', labelKey: 'sqlWorkspace.grid.menu.filter' },
  { id: 'exclude', labelKey: 'sqlWorkspace.grid.menu.exclude' },
  { id: 'copy-value', labelKey: 'sqlWorkspace.grid.menu.copyValue' },
  { id: 'copy-row', labelKey: 'sqlWorkspace.grid.menu.copyRow' },
  { id: 'copy-insert', labelKey: 'sqlWorkspace.grid.menu.copyInsert' },
  { id: 'open-value', labelKey: 'sqlWorkspace.grid.menu.openValue' },
];

/** A new row's column left unset, which the table fills with its default. */
const UNSET_CELL = 'default';

/** Numbers right-aligned in the number color, null italic and subtle, the rest in the base text color. */
function cellClass(value: unknown, numeric: boolean): string {
  const base = 'max-w-[32rem] truncate px-2.5 align-middle';
  if (value === null || value === undefined) return `${base} italic text-fg-subtle ${numeric ? 'text-right' : ''}`;
  if (numeric) return `${base} text-right tabular-nums`;
  if (typeof value === 'boolean') return base;
  return `${base} text-fg-base`;
}

/** The syntax hue for a number or a boolean, as a theme variable so the boot stylesheet gains no class. */
function cellColor(value: unknown, numeric: boolean): CSSProperties | undefined {
  if (value === null || value === undefined) return undefined;
  if (numeric) return { color: 'var(--color-syntax-number)' };
  return typeof value === 'boolean' ? { color: 'var(--color-syntax-keyword)' } : undefined;
}

type TypedColumn = { col: SqlColumnMetadata; duckType: string; numeric: boolean };

/** A link, a 0–1 bar, a check or a thumbnail in place of a cell's text; the value itself is unchanged. */
function MagicCell({ magic, text }: { magic: SqlCellMagic; text: string }) {
  const { t } = useTranslation();
  switch (magic.kind) {
    case 'link':
      return (
        <a
          href={magic.href}
          tabIndex={-1}
          title={t('sqlWorkspace.grid.magic.openLink')}
          data-testid="sql-cell-link"
          onClick={(event) => {
            event.preventDefault();
            if (!event.metaKey && !event.ctrlKey) return;
            event.stopPropagation();
            void window.lingua.openExternal(magic.href);
          }}
          className="text-accent-fg underline underline-offset-2"
        >
          {text}
        </a>
      );
    case 'bar':
      return (
        <span className="inline-flex items-center gap-2" data-testid="sql-cell-bar">
          <span aria-hidden="true" className="relative h-1.5 w-12 overflow-hidden rounded bg-border-subtle">
            <span className="absolute inset-y-0 left-0 rounded bg-accent" style={{ width: `${Math.round(magic.value * 100)}%` }} />
          </span>
          {text}
        </span>
      );
    case 'check':
      return (
        <span data-testid="sql-cell-check" aria-label={text} title={text}>
          {magic.on ? '✓' : '✗'}
        </span>
      );
    case 'image':
      return <img src={magic.src} alt="" data-testid="sql-cell-thumb" className="inline-block h-5 max-w-[6rem] rounded-sm object-contain align-middle" />;
  }
}

interface RowActions {
  select: (event: MouseEvent, index: number) => void;
  open: (index: number, column: string) => void;
  menu: (event: MouseEvent, cell: SqlGridCell) => void;
  follow: (column: string, value: unknown) => void;
  /** The inline editor: its text changes, Enter or leaving saves, Escape cancels. */
  draft: (value: string) => void;
  save: () => void;
  cancel: () => void;
}

/** One grid row; memoized so scrolling renders only the rows that enter the window. */
const GridRow = memo(function GridRow({
  row,
  index,
  typed,
  selectedColumn,
  linkedColumns,
  canFollow,
  actions,
  editor,
  fractions,
}: {
  row: Record<string, unknown>;
  index: number;
  typed: ReadonlyArray<TypedColumn>;
  /** The selected column when this row holds the selection, else null. */
  selectedColumn: string | null;
  linkedColumns: ReadonlySet<string> | undefined;
  canFollow: boolean;
  actions: RowActions;
  /** The cell being edited in this row, with its text. */
  editor: { column: string; value: string } | null;
  /** With Rich display on: the numeric columns drawn as 0–1 bars. */
  fractions: ReadonlySet<string> | null;
}) {
  const rowSelected = selectedColumn !== null;
  return (
    <tr
      aria-rowindex={index + 2}
      data-testid="sql-result-preview-row"
      aria-selected={rowSelected}
      data-selected={rowSelected ? 'true' : undefined}
      onClick={(event) => actions.select(event, index)}
      className={`h-[26px] border-b border-border-subtle ${rowSelected ? 'bg-editor-line-hl' : 'hover:bg-bg-panel-alt/60'}`}
    >
      {typed.map(({ col, duckType, numeric }) => {
        const value = row[col.name];
        const isNull = value === null || value === undefined;
        const cellSelected = selectedColumn === col.name;
        const linked = !isNull && canFollow && linkedColumns?.has(col.name) === true;
        const tone = cellTone(row, col.name);
        const magic = fractions && !linked ? cellMagic(value, duckType, fractions.has(col.name)) : null;
        if (editor?.column === col.name) {
          return (
            <td key={col.name} role="gridcell" data-column={col.name} className="p-0">
              <input
                autoFocus
                data-testid="sql-cell-editor"
                aria-label={col.name}
                value={editor.value}
                placeholder={isNull ? 'NULL' : undefined}
                onChange={(event) => actions.draft(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') actions.save();
                  if (event.key === 'Escape') actions.cancel();
                }}
                onBlur={actions.save}
                className="h-[25px] w-full min-w-[8rem] bg-bg-inset px-2.5 font-mono text-caption text-fg-base outline outline-1 -outline-offset-1 outline-accent"
              />
            </td>
          );
        }
        return (
          <td
            key={col.name}
            role="gridcell"
            aria-selected={cellSelected}
            data-column={col.name}
            data-null={isNull ? 'true' : undefined}
            data-edit={tone}
            onDoubleClick={() => actions.open(index, col.name)}
            onContextMenu={(event) => actions.menu(event, { row: index, column: col.name })}
            className={cn(cellClass(value, numeric), tone && TONE_CLASS[tone], cellSelected && 'outline outline-1 -outline-offset-1 outline-accent')}
            style={cellColor(value, numeric)}
          >
            {linked ? (
              <button
                type="button"
                tabIndex={-1}
                data-testid="sql-result-fk-link"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.follow(col.name, value);
                }}
                className="text-accent-fg underline underline-offset-2 hover:text-accent"
              >
                {renderCell(value)} →
              </button>
            ) : tone === 'inserted' && value === undefined ? (
              UNSET_CELL
            ) : magic ? (
              <MagicCell magic={magic} text={renderCell(value)} />
            ) : (
              renderCell(value)
            )}
          </td>
        );
      })}
    </tr>
  );
});

/** The edit items a cell's menu starts with: edit and NULL for an editable cell, then duplicate and delete or restore. */
function editActionsFor(editing: SqlGridEditing, row: Record<string, unknown>, column: string) {
  const deleted = (row as ShownRow)[DELETED] === true;
  return EDIT_ACTIONS.filter(({ id }) => (id === 'edit-cell' || id === 'set-null' ? editing.canEdit(row, column) : !(deleted && id === 'duplicate-row'))).map((action) =>
    action.id === 'delete-row' && deleted ? { ...action, labelKey: 'sqlWorkspace.edits.menu.restore' } : action
  );
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
  editing,
  magics = false,
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
  editing?: SqlGridEditing;
  /** Rich display: links, 0–1 bars, checks and thumbnails in the cells. */
  magics?: boolean;
}) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<{ row: number; column: string; value: string; target: Record<string, unknown>; wasEmpty: boolean } | null>(null);
  const editorRef = useRef(editor);
  useLayoutEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  /** Double-click and Enter edit a cell that can be edited, and open the value otherwise. */
  const openCell = (cell: SqlGridCell) => {
    const row = rows[cell.row];
    if (editing && row && editing.canEdit(row, cell.column)) {
      const text = cellText(row[cell.column]);
      setEditor({ ...cell, value: text ?? '', target: row, wasEmpty: text === null });
    } else onCellAction('open-value', cell);
  };
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

  const fractions = useMemo(
    () => (magics ? fractionColumns(typed.map(({ col, numeric }) => ({ name: col.name, numeric })), rows) : null),
    [magics, typed, rows]
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
    else if (event.key === 'Enter' && selected) openCell(selected);
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

  // Rows get one stable set of handlers that read the latest props, so a re-render skips them.
  const latest = useRef({ onSelect, onCellAction, onFollowLink, openMenu, selected, typed, openCell, editing });
  useLayoutEffect(() => {
    latest.current = { onSelect, onCellAction, onFollowLink, openMenu, selected, typed, openCell, editing };
  });
  const rowActions = useMemo<RowActions>(
    () => ({
      select: (event, index) => {
        const { selected: current, typed: shown } = latest.current;
        const column = (event.target as HTMLElement).closest('td')?.dataset.column ?? current?.column ?? shown[0]?.col.name;
        if (column) latest.current.onSelect({ row: index, column });
      },
      open: (index, column) => latest.current.openCell({ row: index, column }),
      menu: (event, cell) => latest.current.openMenu(event, cell),
      follow: (column, value) => latest.current.onFollowLink?.(column, value),
      draft: (value) => setEditor((current) => (current ? { ...current, value } : current)),
      save: () => {
        const current = editorRef.current;
        if (!current) return;
        editorRef.current = null;
        setEditor(null);
        // A NULL or default cell left empty stays as it was, not an empty string.
        if (!(current.wasEmpty && current.value === '')) latest.current.editing?.onEditCell(current.target, current.column, current.value);
        scrollRef.current?.focus();
      },
      cancel: () => {
        editorRef.current = null;
        setEditor(null);
        scrollRef.current?.focus();
      },
    }),
    []
  );

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
            return (
              <GridRow
                key={index}
                row={row}
                index={index}
                typed={typed}
                selectedColumn={selected?.row === index ? selected.column : null}
                linkedColumns={linkedColumns}
                canFollow={onFollowLink !== undefined}
                actions={rowActions}
                editor={editor?.row === index ? { column: editor.column, value: editor.value } : null}
                fractions={fractions}
              />
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
              style={{ position: 'fixed', left: Math.min(menu.x, globalThis.innerWidth - 220), top: Math.min(menu.y, globalThis.innerHeight - (editing ? 300 : 190)) }}
              className="z-50 w-[210px] rounded-lg border border-border-default bg-bg-panel p-1 text-body-sm shadow-lg"
            >
              {[...(editing && rows[menu.cell.row] ? editActionsFor(editing, rows[menu.cell.row]!, menu.cell.column) : []), ...CELL_ACTIONS].map(({ id, labelKey }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  data-testid={`sql-cell-menu-${id}`}
                  onClick={() => {
                    setMenu(null);
                    if (id === 'edit-cell') openCell(menu.cell);
                    else onCellAction(id, menu.cell);
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

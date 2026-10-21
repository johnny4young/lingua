/**
 * Filter bar over the result grid: free-text search, condition chips, the
 * sort chip and the column picker, with the SQL that does the same below.
 */

import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { cn } from '../../utils/cn';
import {
  SQL_FILTER_OPS,
  opTakesValue,
  visibleColumns,
  type SqlColumnLayout,
  type SqlFilterCondition,
  type SqlFilterOp,
} from './sqlResultFilters';
import type { SqlSortState } from './sqlResultGrid';
import { useFloatingPosition } from './useFloatingPosition';

const CHIP =
  'focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-caption transition-colors';
const chipClass = (pressed: boolean) =>
  cn(CHIP, pressed ? 'border-accent bg-accent-tint text-accent-fg' : 'border-border-default text-fg-muted hover:text-fg-base');
const FIELD =
  'h-7 w-full rounded-md border border-border-default bg-bg-inset px-2 text-body-sm text-fg-base focus:border-border-strong focus:outline-none';

const opLabel = (op: SqlFilterOp, t: (key: string) => string) =>
  op === 'contains' || op === 'is-null' || op === 'not-null' ? t(`sqlWorkspace.grid.op.${op}`) : op;

function Popover({ anchor, onClose, children, testId }: { anchor: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const position = useFloatingPosition(anchor, true, 'below');
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && (ref.current?.contains(event.target as Node) || anchor.current?.contains(event.target as Node))) return;
      onClose();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="dialog" data-testid={testId} style={{ ...position, right: undefined, left: Math.max(8, Math.min(anchor.current?.getBoundingClientRect().left ?? 8, globalThis.innerWidth - 270)) }} className="z-50 w-[260px] rounded-lg border border-border-default bg-bg-panel p-2.5 shadow-lg">
      {children}
    </div>,
    document.body
  );
}

function ConditionEditor({ columns, onAdd, onClose, anchor }: { columns: ReadonlyArray<SqlColumnMetadata>; onAdd: (c: Omit<SqlFilterCondition, 'id'>) => void; onClose: () => void; anchor: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const [column, setColumn] = useState(columns[0]?.name ?? '');
  const [op, setOp] = useState<SqlFilterOp>('=');
  const [value, setValue] = useState('');
  return (
    <Popover anchor={anchor} onClose={onClose} testId="sql-condition-editor">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (column) onAdd({ column, op, value });
        }}
      >
        <select aria-label={t('sqlWorkspace.grid.conditionColumn')} value={column} onChange={(e) => setColumn(e.target.value)} data-testid="sql-condition-column" className={FIELD}>
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label={t('sqlWorkspace.grid.conditionOp')} value={op} onChange={(e) => setOp(e.target.value as SqlFilterOp)} data-testid="sql-condition-op" className={FIELD}>
          {SQL_FILTER_OPS.map((o) => (
            <option key={o} value={o}>
              {opLabel(o, t)}
            </option>
          ))}
        </select>
        {opTakesValue(op) ? (
          <input autoFocus aria-label={t('sqlWorkspace.grid.conditionValue')} value={value} onChange={(e) => setValue(e.target.value)} data-testid="sql-condition-value" className={FIELD} />
        ) : null}
        <button type="submit" data-testid="sql-condition-add" className="button-primary self-end">
          {t('sqlWorkspace.grid.conditionAdd')}
        </button>
      </form>
    </Popover>
  );
}

function ColumnPicker({ columns, layout, onChange, onClose, anchor }: { columns: ReadonlyArray<SqlColumnMetadata>; layout: SqlColumnLayout; onChange: (l: SqlColumnLayout) => void; onClose: () => void; anchor: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const ordered = [...layout.order.filter((n) => columns.some((c) => c.name === n)), ...columns.map((c) => c.name).filter((n) => !layout.order.includes(n))];
  const move = (index: number, delta: number) => {
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange({ ...layout, order: next });
  };
  return (
    <Popover anchor={anchor} onClose={onClose} testId="sql-column-picker">
      <ul className="max-h-[260px] overflow-auto" aria-label={t('sqlWorkspace.grid.columns')}>
        {ordered.map((name, index) => {
          const shown = !layout.hidden.includes(name);
          return (
            <li key={name} className="flex h-7 items-center gap-1.5">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-body-sm text-fg-base">
                <input
                  type="checkbox"
                  checked={shown}
                  data-testid="sql-column-toggle"
                  data-column={name}
                  onChange={() =>
                    onChange({ ...layout, hidden: shown ? [...layout.hidden, name] : layout.hidden.filter((h) => h !== name) })
                  }
                />
                <span className="truncate font-mono text-caption">{name}</span>
              </label>
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('sqlWorkspace.grid.moveUp', { name })} className="focus-ring rounded p-0.5 text-fg-subtle hover:text-fg-base disabled:opacity-30">
                <ChevronUp size={12} aria-hidden="true" />
              </button>
              <button type="button" disabled={index === ordered.length - 1} onClick={() => move(index, 1)} aria-label={t('sqlWorkspace.grid.moveDown', { name })} className="focus-ring rounded p-0.5 text-fg-subtle hover:text-fg-base disabled:opacity-30">
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => onChange({ order: [], hidden: [] })} data-testid="sql-column-reset" className="mt-1.5 text-caption text-accent-fg hover:underline">
        {t('sqlWorkspace.grid.columnsReset')}
      </button>
    </Popover>
  );
}

export function SqlResultToolbar({
  columns,
  search,
  onSearchChange,
  searchCount,
  conditions,
  onConditionsChange,
  sort,
  onSortChange,
  layout,
  onLayoutChange,
  gridSql,
  onApplySql,
}: {
  columns: ReadonlyArray<SqlColumnMetadata>;
  search: string;
  onSearchChange: (value: string) => void;
  /** `shown of total` while a search or condition narrows the rows. */
  searchCount: string | null;
  conditions: ReadonlyArray<SqlFilterCondition>;
  onConditionsChange: (next: SqlFilterCondition[]) => void;
  sort: SqlSortState;
  onSortChange: (next: SqlSortState) => void;
  layout: SqlColumnLayout;
  onLayoutChange: (next: SqlColumnLayout) => void;
  /** The grid as SQL; null when the grid adds nothing to the query. */
  gridSql: string | null;
  /** Present when the query behind the rows is known. */
  onApplySql?: (sql: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const columnsRef = useRef<HTMLButtonElement | null>(null);
  const shownCount = visibleColumns(columns, layout).length;
  const live = conditions.filter((c) => columns.some((col) => col.name === c.column));

  return (
    <div className="flex shrink-0 flex-col border-b border-border-subtle">
      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <span className="flex h-6 w-48 min-w-[9rem] shrink items-center gap-1.5 rounded-md border border-border-default bg-bg-inset px-2 focus-within:border-border-strong">
          <Search size={11} aria-hidden="true" className="shrink-0 text-fg-subtle" />
          <input
            type="text"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            data-testid="sql-result-preview-filter"
            placeholder={t('sqlWorkspace.grid.filterPlaceholder')}
            aria-label={t('sqlWorkspace.grid.filterAria')}
            className="min-w-0 flex-1 bg-transparent font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:outline-none"
          />
          {search.length > 0 ? (
            <button type="button" onClick={() => onSearchChange('')} aria-label={t('sqlWorkspace.grid.filterClear')} title={t('sqlWorkspace.grid.filterClear')} data-testid="sql-result-preview-filter-clear" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <X size={10} aria-hidden="true" />
            </button>
          ) : null}
        </span>
        {live.map((condition) => (
          <span key={condition.id} data-testid="sql-condition-chip" className={chipClass(true)}>
            <span className="max-w-[14rem] truncate font-mono">
              {condition.column} {opLabel(condition.op, t)}
              {opTakesValue(condition.op) ? ` ${condition.value}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onConditionsChange(conditions.filter((c) => c.id !== condition.id))}
              aria-label={t('sqlWorkspace.grid.conditionRemove', { column: condition.column })}
              className="rounded-full hover:text-fg-base"
            >
              <X size={10} aria-hidden="true" />
            </button>
          </span>
        ))}
        <button ref={addRef} type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} data-testid="sql-condition-new" className={chipClass(false)}>
          <Plus size={10} aria-hidden="true" />
          {t('sqlWorkspace.grid.conditionNew')}
        </button>
        {sort.column !== null ? (
          <span data-testid="sql-sort-chip" className={chipClass(true)}>
            <button type="button" onClick={() => onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })} className="inline-flex items-center gap-1 font-mono">
              {t('sqlWorkspace.grid.sortChip', { column: sort.column })}
              {sort.direction === 'asc' ? <ArrowUp size={10} aria-hidden="true" /> : <ArrowDown size={10} aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => onSortChange({ column: null, direction: 'asc' })} aria-label={t('sqlWorkspace.grid.sortClear')} className="rounded-full hover:text-fg-base">
              <X size={10} aria-hidden="true" />
            </button>
          </span>
        ) : null}
        <button ref={columnsRef} type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} data-testid="sql-columns-chip" className={chipClass(shownCount !== columns.length)}>
          {t('sqlWorkspace.grid.columnsChip', { shown: shownCount, total: columns.length })}
        </button>
        {searchCount !== null ? (
          <span data-testid="sql-result-preview-filter-count" className="ml-auto shrink-0 font-mono text-eyebrow tabular-nums text-fg-subtle">
            {searchCount}
          </span>
        ) : null}
      </div>
      {gridSql !== null ? (
        <div data-testid="sql-grid-sql" className="flex min-w-0 items-center gap-2 border-t border-border-subtle px-2.5 py-1">
          <span className="shrink-0 font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t('sqlWorkspace.grid.asSql')}</span>
          <span title={gridSql} className="min-w-0 flex-1 truncate font-mono text-caption text-fg-muted">
            {gridSql.replace(/\s+/g, ' ')}
          </span>
          {onApplySql ? (
            <button type="button" onClick={() => onApplySql(gridSql)} data-testid="sql-grid-sql-apply" className="shrink-0 text-caption font-medium text-accent-fg hover:underline">
              {t('sqlWorkspace.grid.applyToQuery')}
            </button>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <ConditionEditor
          anchor={addRef}
          columns={columns}
          onClose={() => setEditing(false)}
          onAdd={(condition) => {
            onConditionsChange([...conditions, { ...condition, id: crypto.randomUUID() }]);
            setEditing(false);
          }}
        />
      ) : null}
      {picking ? <ColumnPicker anchor={columnsRef} columns={columns} layout={layout} onChange={onLayoutChange} onClose={() => setPicking(false)} /> : null}
    </div>
  );
}

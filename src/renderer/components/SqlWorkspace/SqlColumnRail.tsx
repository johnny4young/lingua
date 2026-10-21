import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';
import {
  betweenPredicate,
  columnStats,
  equalsPredicate,
  type SqlColumnStats,
} from './sqlColumnStats';

const BAR_MAX = 20;

function Histogram({ stats, onInsert }: { stats: SqlColumnStats; onInsert?: (predicate: string) => void }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<number | null>(null);
  const peak = Math.max(1, ...stats.bins.map((bin) => bin.count), ...stats.top.map((top) => top.count));
  if (stats.kind === 'text') {
    return (
      <span className="flex shrink-0 items-end gap-[2px]" aria-hidden="true">
        {stats.top.map((top) => (
          <span key={top.value} className="block w-1.5 rounded-[1px] bg-accent" style={{ height: Math.max(2, (top.count / peak) * BAR_MAX) }} />
        ))}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-end gap-[2px]">
      {stats.bins.map((bin, index) => (
        <button
          key={index}
          type="button"
          disabled={!onInsert}
          title={t('sqlWorkspace.rail.binTitle', { count: bin.count })}
          aria-label={t('sqlWorkspace.rail.insertBetween', { column: stats.name })}
          data-testid="sql-rail-bin"
          onClick={(event) => {
            if (!onInsert) return;
            // Shift-click extends from the bin clicked before, for a range.
            const from = event.shiftKey && anchor !== null ? stats.bins[anchor]! : bin;
            onInsert(betweenPredicate(stats, from, bin));
            setAnchor(index);
          }}
          className="block w-1.5 rounded-[1px] bg-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
          style={{ height: Math.max(2, (bin.count / peak) * BAR_MAX) }}
        />
      ))}
    </span>
  );
}

/** Always-on column summary beside the grid, from the rows already loaded. */
export function SqlColumnRail({
  columns,
  rows,
  onInsert,
}: {
  columns: ReadonlyArray<SqlColumnMetadata>;
  rows: ReadonlyArray<Record<string, unknown>>;
  /** Inserts a predicate at the editor cursor; absent when no query is open. */
  onInsert?: (predicate: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const stats = useMemo(() => columnStats(columns, rows), [columns, rows]);
  return (
    <aside
      data-testid="sql-column-rail"
      aria-label={t('sqlWorkspace.rail.label')}
      className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-bg-panel"
    >
      <header className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t('sqlWorkspace.rail.label')}</span>
        <span data-testid="sql-column-rail-sample" className="min-w-0 truncate font-mono text-micro text-fg-subtle">
          {t('sqlWorkspace.rail.sample', { count: rows.length, formatted: formatNumber(rows.length, i18n.language) })}
        </span>
      </header>
      <ul className="min-h-0 flex-1 overflow-auto">
        {stats.map((column) => (
          <li key={column.name} data-testid="sql-rail-column" data-column={column.name} className="border-b border-border-subtle px-3 py-2">
            <div className="flex min-w-0 items-end gap-2">
              <span className="min-w-0 truncate text-caption font-semibold text-fg-base" title={column.name}>
                {column.name}
              </span>
              <span className="shrink-0 font-mono text-micro text-accent-fg">{column.duckType}</span>
              <span className="flex-1" />
              <Histogram stats={column} {...(onInsert ? { onInsert } : {})} />
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2.5 font-mono text-micro text-fg-muted">
              <span className={cn(column.nullShare > 0 && 'text-warning-fg')}>
                {t('sqlWorkspace.rail.nulls', { share: Math.round(column.nullShare * 100) })}
              </span>
              <span>{t('sqlWorkspace.rail.distinct', { count: column.distinct, formatted: formatNumber(column.distinct, i18n.language) })}</span>
              <span className="flex-1" />
              {column.range ? (
                <span className="min-w-0 truncate" title={`${column.range.low} – ${column.range.high}`}>
                  {column.range.low === column.range.high ? column.range.low : `${column.range.low}–${column.range.high}`}
                </span>
              ) : null}
            </div>
            {column.kind === 'text' && column.top.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {column.top.map((top) => (
                  <button
                    key={top.value}
                    type="button"
                    disabled={!onInsert}
                    onClick={() => onInsert?.(equalsPredicate(column, top.value))}
                    title={t('sqlWorkspace.rail.insertEquals', { column: column.name, value: top.value })}
                    data-testid="sql-rail-value"
                    className="focus-ring inline-flex h-5 max-w-[9rem] items-center gap-1 rounded border border-border-subtle px-1.5 font-mono text-micro text-fg-muted hover:border-border-strong hover:text-fg-base disabled:hover:border-border-subtle"
                  >
                    <span className="truncate">{top.value}</span>
                    <span className="shrink-0 text-fg-subtle">{top.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

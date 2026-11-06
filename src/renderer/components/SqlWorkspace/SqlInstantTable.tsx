/**
 * The rows of an Instant SQL sample. A computed column's header opens its
 * breakdown, and a sub-expression narrows the table to the rows behind it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import '../../i18n/sqlInstantCatalog';
import { breakdownSource, computedColumns } from '../../../shared/sqlExprBreakdown';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { runInstantPreview, type InstantPreviewResult } from '../../runtime/sqlInstantPreview';
import { cn } from '../../utils/cn';
import { SqlExprBreakdown, type BreakdownSelection } from './SqlExprBreakdown';
import { renderCell } from './sqlResultFormatters';

const RENDERED_ROWS = 100;

export type InstantShown = Extract<InstantPreviewResult, { kind: 'rows' }> & { cte?: string };

export interface SqlInstantTableProps {
  shown: InstantShown;
  dimmed: boolean;
  /** A Run or a newer sample is in flight, so nothing new starts and what runs stops. */
  busy: boolean;
  /** DuckDB did not stop a query this table started. */
  onStuck: () => void;
}

export function SqlInstantTable({ shown, dimmed, busy, onStuck }: SqlInstantTableProps) {
  const { t, i18n } = useTranslation();
  const [openColumn, setOpenColumn] = useState<string | null>(null);
  // Each stays valid only for the sample it was asked on.
  const [selection, setSelection] = useState<{ shown: InstantShown; pick: BreakdownSelection } | null>(null);
  const [narrowed, setNarrowed] = useState<{ pick: BreakdownSelection; result: InstantPreviewResult } | null>(null);

  const source = useMemo(() => breakdownSource(shown.statements, shown.cte), [shown]);
  const computed = useMemo(() => (source ? computedColumns(source, shown.columns.map((column) => column.name)) : []), [source, shown]);
  const opened = computed.find((column) => column.column === openColumn);
  const pick = opened && selection?.shown === shown ? selection.pick : null;
  const pickSql = pick?.sql;

  useEffect(() => {
    if (!pick || pickSql === undefined || busy) return;
    const controller = new AbortController();
    void runInstantPreview(pickSql, controller.signal).then((result) => {
      if (!result || controller.signal.aborted) return;
      setNarrowed({ pick, result });
      if (result.kind === 'timeout' && result.stuck) onStuck();
    });
    return () => controller.abort();
  }, [pick, pickSql, busy, onStuck]);

  const outcome = pick && narrowed?.pick === pick ? narrowed.result : null;
  const rows = pick && outcome?.kind === 'rows' ? outcome.rows : shown.rows;
  const columns = shown.columns.map((column) => {
    const type = arrowTypeToDuckDb(column.type);
    return { name: column.name, type, numeric: isNumericSqlType(type), computed: computed.some((entry) => entry.column === column.name) };
  });
  const select = (next: BreakdownSelection | null) => setSelection(next ? { shown, pick: next } : null);

  return (
    <div {...(opened ? { 'data-breakdown-open': true } : {})} className="@container flex min-h-0 min-w-0 flex-col px-3 pb-2">
      <div className="flex min-h-0 min-w-0 flex-col gap-x-4 gap-y-2 @2xl:flex-row">
        <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto', dimmed && 'opacity-60')}>
          {pick ? (
            <p data-testid="sql-instant-narrowed" className="flex items-baseline gap-3 pb-1 font-mono text-caption text-fg-muted">
              <span className="min-w-0 truncate">
                {t(pick.divisor ? 'sqlWorkspace.instant.breakdown.filterZero' : 'sqlWorkspace.instant.breakdown.filter', { label: pick.label })}
              </span>
              <button type="button" data-testid="sql-instant-narrowed-clear" onClick={() => select(null)} className="focus-ring shrink-0 rounded-sm text-accent-fg hover:underline">
                {t('sqlWorkspace.instant.breakdown.clear')}
              </button>
            </p>
          ) : null}
          <table data-testid="sql-instant-table" className="w-full border-collapse font-mono text-caption">
            <thead className="sticky top-0 bg-bg-panel text-left text-fg-subtle">
              <tr>
                {columns.map((column) => (
                  <th key={column.name} scope="col" className={cn('whitespace-nowrap py-1 pr-4 font-normal', column.numeric && 'text-right')}>
                    {column.computed ? (
                      <button
                        type="button"
                        data-testid="sql-instant-column-breakdown"
                        aria-expanded={openColumn === column.name}
                        aria-label={t('sqlWorkspace.instant.breakdown.open', { name: column.name })}
                        onClick={() => {
                          setOpenColumn(openColumn === column.name ? null : column.name);
                          setSelection(null);
                        }}
                        className="focus-ring rounded-sm underline decoration-dotted underline-offset-2 hover:text-fg-base"
                      >
                        {column.name}
                      </button>
                    ) : (
                      column.name
                    )}{' '}
                    <span className="text-accent-fg">{column.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, RENDERED_ROWS).map((row, index) => (
                <tr key={index} className="border-t border-border-subtle">
                  {columns.map((column) => (
                    <td key={column.name} className={cn('whitespace-nowrap py-1 pr-4 text-fg-base', column.numeric && 'text-right tabular-nums')}>
                      {renderCell(row[column.name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > RENDERED_ROWS ? (
            <p className="pt-1 text-caption text-fg-subtle">
              {t('sqlWorkspace.instant.moreRows', { count: rows.length - RENDERED_ROWS, rows: formatNumber(rows.length - RENDERED_ROWS, i18n.language) })}
            </p>
          ) : null}
          {outcome && outcome.kind !== 'rows' ? (
            <p role="status" data-testid="sql-instant-narrowed-error" className="pt-1 font-mono text-caption text-error-fg">
              {outcome.kind === 'error' ? outcome.message : t('sqlWorkspace.instant.breakdown.narrowFailed')}
            </p>
          ) : null}
        </div>
        {opened && source ? (
          <SqlExprBreakdown source={source} expr={opened.expr} column={opened.column} busy={busy} selected={pick?.index ?? null} onSelect={select} onStuck={onStuck} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Instant SQL (Labs): a sampled preview of the statement under the cursor,
 * or of the CTE the cursor is in, that refreshes as you type. Local only;
 * anything that writes, reads remotely or has side effects never auto-runs.
 */

import { RefreshCw } from 'lucide-react';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import { INSTANT_SAMPLE_ROWS, type InstantBlockReason } from '../../../shared/sqlCtePreview';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { INSTANT_TIMEOUT_MS, runInstantPreview, type InstantPreviewResult } from '../../runtime/sqlInstantPreview';
import { cn } from '../../utils/cn';
import { StatusBadge } from '../ui/StatusBadge';
import { instantPreviewVisible, type InstantSqlChannel } from './instantSqlChannel';
import { renderCell } from './sqlResultFormatters';

export const INSTANT_DEBOUNCE_MS = 250;
const RENDERED_ROWS = 100;

type Shown = Extract<InstantPreviewResult, { kind: 'rows' }> & { cte?: string };

type PreviewState =
  | { kind: 'idle'; shown?: Shown }
  | { kind: 'running'; shown?: Shown }
  | { kind: 'shown'; shown: Shown }
  | { kind: 'error'; message: string; shown?: Shown }
  | { kind: 'timeout'; shown?: Shown }
  | { kind: 'rejected'; shown?: Shown }
  | { kind: 'blocked'; reason: InstantBlockReason; shown?: Shown };

export interface SqlInstantPreviewProps {
  channel: InstantSqlChannel;
  queryId: string;
  /** A Run is in flight; the preview waits for it. */
  busy: boolean;
}

export function SqlInstantPreview({ channel, queryId, busy }: SqlInstantPreviewProps) {
  const { t, i18n } = useTranslation();
  const snapshot = useSyncExternalStore(channel.subscribe, channel.snapshot);
  const plan = snapshot.draft?.plan ?? null;
  const visible = instantPreviewVisible(snapshot, queryId);
  const sql = visible && !busy ? plan?.sql : undefined;
  const cte = plan?.cte;
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    if (sql === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((prev) => ({ kind: 'running', ...(prev.shown ? { shown: prev.shown } : {}) }));
      void runInstantPreview(sql, controller.signal).then((result) => {
        if (!result || controller.signal.aborted) return;
        setState((prev) => {
          const kept = prev.shown ? { shown: prev.shown } : {};
          if (result.kind === 'rows') return { kind: 'shown', shown: { ...result, ...(cte ? { cte } : {}) } };
          if (result.kind === 'error') return { kind: 'error', message: result.message, ...kept };
          if (result.kind === 'blocked') return { kind: 'blocked', reason: result.reason, ...kept };
          return { kind: result.kind, ...kept };
        });
      });
    }, INSTANT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sql, cte]);

  if (!visible || !plan) return null;
  const blocked: InstantBlockReason | 'rejected' | undefined =
    plan.blocked ?? (state.kind === 'rejected' ? 'rejected' : state.kind === 'blocked' ? state.reason : undefined);
  const shown = blocked ? undefined : state.shown;
  const columns = (shown?.columns ?? []).map((column) => {
    const type = arrowTypeToDuckDb(column.type);
    return { name: column.name, type, numeric: isNumericSqlType(type) };
  });
  const rowsLabel = shown
    ? t(shown.capped ? 'sqlWorkspace.instant.rowsCapped' : 'sqlWorkspace.instant.rows', {
        count: shown.rows.length,
        rows: formatNumber(shown.rows.length, i18n.language),
      })
    : null;

  return (
    <section
      data-testid="sql-instant-preview"
      aria-label={t('sqlWorkspace.instant.label')}
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b border-border-subtle bg-bg-panel"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5">
        {blocked ? (
          <StatusBadge tone="warning">{t(`sqlWorkspace.instant.blocked.${blocked}`)}</StatusBadge>
        ) : (
          <StatusBadge tone="success">
            {t('sqlWorkspace.instant.badge', { rows: formatNumber(INSTANT_SAMPLE_ROWS, i18n.language) })}
          </StatusBadge>
        )}
        {shown ? (
          <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle" data-testid="sql-instant-target">
            {shown.cte ? t('sqlWorkspace.instant.cte', { name: shown.cte }) : t('sqlWorkspace.instant.result')}
          </span>
        ) : null}
        {shown && rowsLabel ? (
          <span className="font-mono text-eyebrow tabular-nums text-fg-subtle" data-testid="sql-instant-meta">
            {t('sqlWorkspace.instant.meta', { rows: rowsLabel, ms: formatNumber(shown.durationMs, i18n.language) })}
          </span>
        ) : null}
        {!blocked && state.kind === 'running' ? (
          <span className="text-caption text-fg-subtle" aria-live="polite">
            {t('sqlWorkspace.instant.updating')}
          </span>
        ) : null}
        {plan.crumbs.length > 0 ? (
          <nav aria-label={t('sqlWorkspace.instant.crumbs')} className="ml-auto flex flex-wrap items-center gap-1.5" data-testid="sql-instant-crumbs">
            {plan.crumbs.map((crumb, index) => {
              const label = crumb.label ?? t('sqlWorkspace.instant.resultCrumb');
              return (
                <Fragment key={crumb.key || '(result)'}>
                  {index > 0 ? (
                    <span aria-hidden className="text-caption text-fg-subtle">
                      →
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={crumb.active}
                    data-testid="sql-instant-crumb"
                    data-dependent={crumb.dependent || undefined}
                    onClick={() => channel.jumpTo(crumb.offset)}
                    {...(crumb.dependent ? { title: t('sqlWorkspace.instant.dependent', { name: plan.cte ?? '' }) } : {})}
                    className={cn(
                      'focus-ring inline-flex h-6 items-center gap-1 rounded-full border px-2.5 font-mono text-caption transition-colors',
                      crumb.active ? 'border-accent bg-accent-tint text-accent-fg' : 'border-border-default text-fg-muted hover:text-fg-base'
                    )}
                  >
                    {label}
                    {crumb.dependent ? (
                      <>
                        <RefreshCw size={10} aria-hidden />
                        <span className="sr-only">{t('sqlWorkspace.instant.dependent', { name: plan.cte ?? '' })}</span>
                      </>
                    ) : null}
                  </button>
                </Fragment>
              );
            })}
          </nav>
        ) : null}
      </header>
      {!blocked && (state.kind === 'error' || state.kind === 'timeout') ? (
        <p role="status" data-testid="sql-instant-error" className="truncate px-3 pb-1.5 font-mono text-caption text-error-fg" title={state.kind === 'error' ? state.message : undefined}>
          {state.kind === 'error' ? state.message : t('sqlWorkspace.instant.timeout', { seconds: INSTANT_TIMEOUT_MS / 1000 })}
        </p>
      ) : null}
      {shown ? (
        <div className={cn('min-h-0 overflow-auto px-3 pb-2', state.kind !== 'shown' && 'opacity-60')}>
          <table data-testid="sql-instant-table" className="w-full border-collapse font-mono text-caption">
            <thead className="sticky top-0 bg-bg-panel text-left text-fg-subtle">
              <tr>
                {columns.map((column) => (
                  <th key={column.name} scope="col" className={cn('whitespace-nowrap py-1 pr-4 font-normal', column.numeric && 'text-right')}>
                    {column.name} <span className="text-accent-fg">{column.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.rows.slice(0, RENDERED_ROWS).map((row, index) => (
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
          {shown.rows.length > RENDERED_ROWS ? (
            <p className="pt-1 text-caption text-fg-subtle">
              {t('sqlWorkspace.instant.moreRows', {
                count: shown.rows.length - RENDERED_ROWS,
                rows: formatNumber(shown.rows.length - RENDERED_ROWS, i18n.language),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

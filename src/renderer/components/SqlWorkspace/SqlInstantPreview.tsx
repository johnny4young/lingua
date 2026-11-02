/**
 * Instant SQL (Labs): a sampled preview of the statement under the cursor,
 * or of the CTE the cursor is in, that refreshes as you type. Local only;
 * anything that writes, reads remotely or has side effects never auto-runs.
 */

import { RefreshCw } from 'lucide-react';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import '../../i18n/sqlInstantCatalog';
import { INSTANT_SAMPLE_ROWS, type InstantBlockReason } from '../../../shared/sqlCtePreview';
import { INSTANT_TIMEOUT_MS, runInstantPreview } from '../../runtime/sqlInstantPreview';
import { cn } from '../../utils/cn';
import { StatusBadge } from '../ui/StatusBadge';
import { instantPreviewVisible, type InstantSqlChannel, type InstantSqlDraft } from './instantSqlChannel';
import { SqlInstantTable, type InstantShown } from './SqlInstantTable';

export const INSTANT_DEBOUNCE_MS = 250;
type Shown = InstantShown;

type PreviewState =
  | { kind: 'idle'; shown?: Shown }
  | { kind: 'running'; shown?: Shown }
  | { kind: 'shown'; shown: Shown }
  | { kind: 'error'; message: string; shown?: Shown }
  | { kind: 'timeout'; shown?: Shown }
  | { kind: 'rejected'; sql: string; shown?: Shown }
  | { kind: 'blocked'; reason: InstantBlockReason; sql: string; shown?: Shown }
  /** DuckDB did not stop the last sample; previews wait for the next Run. */
  | { kind: 'stuck'; ran: InstantSqlDraft | null; shown?: Shown };

export interface SqlInstantPreviewProps {
  channel: InstantSqlChannel;
  queryId: string;
  /** A Run is in flight; the preview waits for it. */
  busy: boolean;
}

export function SqlInstantPreview({ channel, queryId, busy }: SqlInstantPreviewProps) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });
  const snapshot = useSyncExternalStore(channel.subscribe, channel.snapshot);
  const plan = snapshot.draft?.plan ?? null;
  const visible = instantPreviewVisible(snapshot, queryId);
  const stuck = state.kind === 'stuck' && state.ran === snapshot.ran;
  const sql = visible && !busy && !stuck ? plan?.sql : undefined;
  const cte = plan?.cte;

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
          if (result.kind === 'blocked') return { kind: 'blocked', reason: result.reason, sql, ...kept };
          if (result.kind === 'rejected') return { kind: 'rejected', sql, ...kept };
          if (result.kind === 'timeout' && result.stuck) return { kind: 'stuck', ran: channel.snapshot().ran, ...kept };
          return { kind: result.kind, ...kept };
        });
      });
    }, INSTANT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sql, cte, channel]);

  if (!visible || !plan) return null;
  // A verdict on other SQL says nothing about this one.
  const verdict = (state.kind === 'rejected' || state.kind === 'blocked') && state.sql === plan.sql ? state : undefined;
  const blocked: InstantBlockReason | 'rejected' | undefined =
    plan.blocked ?? (verdict?.kind === 'blocked' ? verdict.reason : verdict?.kind);
  const shown = blocked ? undefined : state.shown;
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
      {!blocked && (state.kind === 'error' || state.kind === 'timeout' || stuck) ? (
        <p role="status" data-testid="sql-instant-error" className="truncate px-3 pb-1.5 font-mono text-caption text-error-fg" title={state.kind === 'error' ? state.message : undefined}>
          {state.kind === 'error'
            ? state.message
            : stuck
              ? t('sqlWorkspace.instant.stuck')
              : t('sqlWorkspace.instant.timeout', { seconds: INSTANT_TIMEOUT_MS / 1000 })}
        </p>
      ) : null}
      {shown ? <SqlInstantTable shown={shown} dimmed={state.kind !== 'shown'} busy={busy} /> : null}
    </section>
  );
}

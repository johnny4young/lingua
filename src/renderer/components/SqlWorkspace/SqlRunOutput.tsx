import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SqlResultView, SqlRunSet } from '../../hooks/useSqlRunner';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../i18n/formatNumber';
import { StatusBadge } from '../ui/StatusBadge';
import { toneForSqlStatus } from './sqlStatusTone';

const sameView = (a: SqlResultView | null, b: SqlResultView) =>
  a !== null && a.kind === b.kind && (a.kind !== 'result' || (b.kind === 'result' && a.index === b.index));

/** Result N per statement plus Messages after a run of several statements, and Plan after Explain. */
export function SqlResultTabs({
  runSet,
  hasPlan,
  view,
  onSelect,
}: {
  runSet: SqlRunSet | null;
  hasPlan: boolean;
  view: SqlResultView;
  onSelect: (view: SqlResultView) => void;
}) {
  const { t, i18n } = useTranslation();
  const items: Array<{ id: string; label: string; target: SqlResultView }> = runSet
    ? [
        ...runSet.results.map(({ response }, index) => ({
          id: `result-${index}`,
          label:
            response.status === 'success' || response.status === 'too-large'
              ? t('sqlWorkspace.results.resultRows', {
                  n: index + 1,
                  count: response.rowCount,
                  formatted: formatNumber(response.rowCount, i18n.language),
                  atLeast: response.rowCountIsLowerBound ? '≥ ' : '',
                })
              : t('sqlWorkspace.results.resultStatus', {
                  n: index + 1,
                  status: t(`sqlWorkspace.statusPill.${response.status}`),
                }),
          target: { kind: 'result', index } as const,
        })),
        { id: 'messages', label: t('sqlWorkspace.results.messages'), target: { kind: 'messages' } as const },
      ]
    : [{ id: 'result-0', label: t('sqlWorkspace.results.result'), target: { kind: 'result', index: 0 } as const }];
  if (hasPlan) items.push({ id: 'plan', label: t('sqlWorkspace.results.plan'), target: { kind: 'plan' } });
  return (
    <div
      role="tablist"
      aria-label={t('sqlWorkspace.results.label')}
      data-testid="sql-result-tabs"
      className="flex h-[28px] shrink-0 items-stretch overflow-x-auto border-b border-border-subtle bg-bg-panel"
    >
      {items.map((item) => {
        const active = sameView(view, item.target);
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`sql-result-tab-${item.id}`}
            onClick={() => onSelect(item.target)}
            className={cn(
              'shrink-0 border-r border-border-subtle px-3 font-mono text-micro transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
              active
                ? 'bg-bg-base text-fg-base shadow-[inset_0_-2px_0_var(--color-accent)]'
                : 'text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** One line per statement of a run: what ran, how it ended, and what never ran. */
export function SqlRunMessages({ runSet }: { runSet: SqlRunSet }) {
  const { t } = useTranslation();
  const line = 'grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle px-3 py-1.5';
  return (
    <ol data-testid="sql-run-messages" className="h-full min-h-0 overflow-auto bg-bg-base">
      {runSet.results.map(({ sql, response }, index) => (
        <li key={index} data-testid="sql-run-message" data-status={response.status} className={line}>
          <span className="font-mono text-micro tabular-nums text-fg-subtle">#{index + 1}</span>
          <div className="min-w-0">
            <p title={sql} className="truncate font-mono text-caption text-fg-base">
              {sql.replace(/\s+/g, ' ').trim()}
            </p>
            {response.errorMessage && response.status !== 'success' ? (
              <p className="break-words font-mono text-micro text-error-fg">{response.errorMessage}</p>
            ) : null}
          </div>
          <span className="flex shrink-0 items-center gap-2 font-mono text-micro tabular-nums text-fg-muted">
            <StatusBadge tone={toneForSqlStatus(response.status)} dot>
              {t(`sqlWorkspace.statusPill.${response.status}`)}
            </StatusBadge>
            {t('sqlWorkspace.results.messageMeta', {
              count: response.rowCount,
              duration: Math.round(response.durationMs),
            })}
          </span>
        </li>
      ))}
      {runSet.notRun.map((sql, offset) => (
        <li key={`not-run-${offset}`} data-testid="sql-run-message" data-status="not-run" className={cn(line, 'opacity-60')}>
          <span className="font-mono text-micro tabular-nums text-fg-subtle">#{runSet.results.length + offset + 1}</span>
          <p title={sql} className="truncate font-mono text-caption text-fg-muted">
            {sql.replace(/\s+/g, ' ').trim()}
          </p>
          <span className="shrink-0 font-mono text-micro text-fg-subtle">{t('sqlWorkspace.results.notRun')}</span>
        </li>
      ))}
    </ol>
  );
}

/** DuckDB kept running after Cancel; restarting the engine is the only way to stop it. */
export function SqlStuckQueryBand({ onRestart, isRestarting }: { onRestart: () => void; isRestarting: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid="sql-stuck-band"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg"
    >
      <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 basis-[220px]">{t('sqlWorkspace.cancel.stillRunning')}</span>
      <button
        type="button"
        onClick={onRestart}
        disabled={isRestarting}
        data-testid="sql-restart-engine"
        className="focus-ring inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border border-warning-border bg-bg-panel px-2 font-medium text-fg-base hover:border-border-strong disabled:opacity-40"
      >
        <RotateCcw size={11} aria-hidden="true" />
        {t('sqlWorkspace.cancel.restart')}
      </button>
    </div>
  );
}

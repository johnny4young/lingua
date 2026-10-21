import { AlertTriangle, Copy } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import {
  flattenPlan,
  formatPlanMs,
  planToText,
  slowestPlanNode,
} from '../../runtime/sqlExplainPlan';
import type { SqlPlanResult } from '../../hooks/useSqlRunner';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../utils/cn';
import { StatusBadge } from '../ui/StatusBadge';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Explain result: the operator tree, with time bars and row counts when analyzed. */
export function SqlPlanView({ result }: { result: SqlPlanResult }) {
  const { t, i18n } = useTranslation();
  const { plan } = result;
  const rows = useMemo(() => (plan ? flattenPlan(plan.roots) : []), [plan]);
  const slowest = plan ? slowestPlanNode(plan) : null;
  const maxMs = slowest?.timingMs ?? 0;

  const copy = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(planToText(plan));
      useUIStore.getState().pushStatusNotice({ tone: 'success', messageKey: 'sqlWorkspace.plan.copied' });
    } catch {
      useUIStore.getState().pushStatusNotice({ tone: 'warning', messageKey: 'sqlWorkspace.plan.copyFailed' });
    }
  };

  return (
    <div data-testid="sql-plan-view" className="flex h-full min-h-0 min-w-0 flex-col bg-bg-base">
      <header className="flex min-h-[34px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-1.5">
        <StatusBadge tone={plan?.analyzed ? 'success' : 'neutral'} dot>
          {t(plan?.analyzed ? 'sqlWorkspace.plan.analyzed' : 'sqlWorkspace.plan.estimated')}
        </StatusBadge>
        {plan?.totalMs !== undefined ? (
          <span data-testid="sql-plan-total" className="font-mono text-caption tabular-nums text-fg-muted">
            {t('sqlWorkspace.plan.total', { time: formatPlanMs(plan.totalMs) })}
          </span>
        ) : null}
        {plan?.peakMemoryBytes !== undefined ? (
          <span data-testid="sql-plan-memory" className="font-mono text-caption tabular-nums text-fg-muted">
            {t('sqlWorkspace.plan.memory', { size: formatBytes(plan.peakMemoryBytes) })}
          </span>
        ) : null}
        <span
          title={result.sql}
          className="min-w-0 flex-1 basis-[120px] truncate font-mono text-micro text-fg-subtle"
        >
          {result.sql.replace(/\s+/g, ' ').trim()}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!plan}
          data-testid="sql-plan-copy"
          className="focus-ring inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2 text-caption font-medium text-fg-base transition-colors hover:border-border-strong disabled:opacity-40"
        >
          <Copy size={11} aria-hidden="true" />
          {t('sqlWorkspace.plan.copy')}
        </button>
      </header>
      {!plan ? (
        <div
          role="alert"
          data-testid="sql-plan-error"
          className="flex items-start gap-2 border-b border-error-border bg-error-bg px-3 py-2 text-caption text-error-fg"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{result.errorMessage}</span>
        </div>
      ) : (
        <ol aria-label={t('sqlWorkspace.plan.label')} className="min-h-0 flex-1 overflow-auto py-1">
          {rows.map(({ node, depth }) => {
            const isSlowest = slowest !== null && node.id === slowest.id;
            return (
              <li
                key={node.id}
                data-depth={depth}
                data-testid="sql-plan-node"
                data-slowest={isSlowest || undefined}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-l-2 py-1 pr-3',
                  isSlowest ? 'border-l-warning-fg bg-warning-bg/60' : 'border-l-transparent'
                )}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-caption font-semibold text-fg-base">{node.name}</span>
                    {isSlowest ? (
                      <span className="shrink-0 font-mono text-micro uppercase tracking-[0.08em] text-warning-fg">
                        {t('sqlWorkspace.plan.slowest')}
                      </span>
                    ) : null}
                  </div>
                  {node.details.length > 0 ? (
                    <p title={node.details.join('\n')} className="truncate font-mono text-micro text-fg-subtle">
                      {node.details.join(' · ')}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono text-micro tabular-nums text-fg-muted">
                  {node.timingMs !== undefined ? (
                    <>
                      <span aria-hidden="true" className="h-1.5 w-[72px] overflow-hidden rounded-full bg-bg-panel-alt">
                        <span
                          className={cn('block h-full rounded-full', isSlowest ? 'bg-warning-fg' : 'bg-accent')}
                          style={{ width: `${maxMs > 0 ? Math.max(2, (node.timingMs / maxMs) * 100) : 0}%` }}
                        />
                      </span>
                      <span className="w-[60px] text-right">{formatPlanMs(node.timingMs)}</span>
                    </>
                  ) : null}
                  {node.rows !== undefined ? (
                    <span className="min-w-[64px] text-right">
                      {t(plan.analyzed ? 'sqlWorkspace.plan.rows' : 'sqlWorkspace.plan.estimatedRows', {
                        count: node.rows,
                        formatted: formatNumber(node.rows, i18n.language),
                      })}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

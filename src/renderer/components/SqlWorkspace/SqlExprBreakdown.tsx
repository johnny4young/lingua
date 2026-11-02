/**
 * Instant SQL's breakdown of one computed column: each sub-expression with
 * its NULL share over the sample, and what a divisor's zeros turn into.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import type { AstNode } from '../../../shared/sqlCtePreview';
import { INSTANT_TIMEOUT_MS } from '../../runtime/sqlInstantPreview';
import { runExprBreakdown, type ExprBreakdown, type ExprBreakdownNode, type ExprBreakdownResult } from '../../runtime/sqlExprBreakdown';
import { cn } from '../../utils/cn';

const ZERO_RESULT = { infinity: '∞', null: 'NULL' } as const;
const DEPTH_INDENT_PX = 14;

export interface BreakdownSelection {
  index: number;
  label: string;
  /** The rows include this divisor's zeros. */
  divisor: boolean;
  sql: string;
}

export interface SqlExprBreakdownProps {
  source: AstNode;
  expr: AstNode;
  column: string;
  busy: boolean;
  selected: number | null;
  onSelect: (selection: BreakdownSelection | null) => void;
}

/** Whole percent, never rounding a real share down to nothing. */
function nullPercent(nulls: number, total: number): string {
  if (nulls === 0 || total === 0) return '0';
  const percent = Math.round((nulls / total) * 100);
  return percent === 0 ? '<1' : String(percent);
}

export function SqlExprBreakdown({ source, expr, column, busy, selected, onSelect }: SqlExprBreakdownProps) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<{ source: AstNode; column: string; outcome: ExprBreakdownResult } | null>(null);

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    void runExprBreakdown(source, expr, column, controller.signal).then((outcome) => {
      if (outcome && !controller.signal.aborted) setResult({ source, column, outcome });
    });
    return () => controller.abort();
  }, [source, expr, column, busy]);

  const outcome = result?.source === source && result.column === column ? result.outcome : null;
  const breakdown: ExprBreakdown | null = outcome?.kind === 'ready' ? outcome.breakdown : null;
  const zerosLabel = (node: ExprBreakdownNode) =>
    node.zeros && node.zeros.rows > 0
      ? t('sqlWorkspace.instant.breakdown.zeros', {
          count: node.zeros.rows,
          rows: formatNumber(node.zeros.rows, i18n.language),
          name: column,
          result: ZERO_RESULT[node.zeros.gives],
        })
      : null;

  return (
    <div data-testid="sql-instant-breakdown" className="min-h-0 min-w-0 flex-1 overflow-auto @2xl:max-w-[45%] @2xl:flex-none @2xl:basis-[40%]">
      <p className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">{t('sqlWorkspace.instant.breakdown.title', { name: column })}</p>
      {!outcome ? (
        <p className="pt-1 text-caption text-fg-subtle" aria-live="polite">
          {t('sqlWorkspace.instant.breakdown.loading')}
        </p>
      ) : null}
      {outcome && !breakdown ? (
        <p role="status" data-testid="sql-instant-breakdown-error" className="pt-1 font-mono text-caption text-error-fg">
          {outcome.kind === 'error'
            ? outcome.message
            : outcome.kind === 'timeout'
              ? t('sqlWorkspace.instant.timeout', { seconds: INSTANT_TIMEOUT_MS / 1000 })
              : t(`sqlWorkspace.instant.blocked.${outcome.kind === 'blocked' ? outcome.reason : 'rejected'}`)}
        </p>
      ) : null}
      {breakdown ? (
        <ul className="pt-1">
          {breakdown.nodes.map((node, index) => {
            const zeros = zerosLabel(node);
            const flagged = node.nulls > 0 || zeros !== null;
            return (
              <li key={index}>
                <button
                  type="button"
                  data-testid="sql-instant-breakdown-node"
                  aria-pressed={selected === index}
                  disabled={!flagged}
                  onClick={() =>
                    onSelect(selected === index ? null : { index, label: node.label, divisor: zeros !== null, sql: breakdown.rowsSql(index) })
                  }
                  style={{ paddingLeft: node.depth * DEPTH_INDENT_PX }}
                  className={cn(
                    'focus-ring flex w-full items-baseline gap-3 rounded-sm py-0.5 pr-1 text-left font-mono text-caption',
                    flagged ? 'hover:bg-bg-panel-alt' : 'cursor-default',
                    selected === index && 'bg-accent-tint text-accent-fg'
                  )}
                >
                  <span className="min-w-0 truncate text-fg-base" title={node.label}>
                    {node.label}
                  </span>
                  <span className={cn('shrink-0 tabular-nums', node.nulls > 0 ? 'text-warning-fg' : 'text-fg-subtle')}>
                    {t('sqlWorkspace.instant.breakdown.nulls', { percent: nullPercent(node.nulls, breakdown.total) })}
                  </span>
                  {zeros ? <span className="shrink-0 tabular-nums text-warning-fg">{zeros}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

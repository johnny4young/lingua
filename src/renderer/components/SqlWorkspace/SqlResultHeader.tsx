import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';
import { ResultHeader, type ResultHeaderTab } from '../ui/ResultHeader';
import { StatusBadge } from '../ui/StatusBadge';
import { sqlPhaseSplit } from './sqlPhaseSplit';
import { toneForSqlStatus } from './sqlStatusTone';

/** The grid's controls in the header, present while rows are on screen. */
interface SqlResultHeaderGrid {
  filterShown: boolean;
  onToggleFilter: () => void;
  onExport: () => void;
  railShown: boolean;
  onToggleRail: () => void;
}

export interface SqlResultHeaderProps {
  response: SqlResponseV1;
  /** Rows known so far, and whether more may follow. */
  total: { count: number; lowerBound: boolean };
  /** Rows the grid shows, when fewer than the total. */
  shownInView: number | null;
  statementPosition?: { index: number; total: number } | undefined;
  tabs?: ReadonlyArray<ResultHeaderTab> | undefined;
  activeTab: string;
  onTabChange: (id: string) => void;
  grid?: SqlResultHeaderGrid | undefined;
}

/** SQL, the row count, time and statement over the phase bar, the views and the grid's actions. */
export function SqlResultHeader({ response, total, shownInView, statementPosition, tabs, activeTab, onTabChange, grid }: SqlResultHeaderProps) {
  const { t, i18n } = useTranslation();
  const num = (value: number) => formatNumber(value, i18n.language);
  const tone = toneForSqlStatus(response.status);
  const hasRows = response.status === 'success' || response.status === 'too-large';
  const statusLabel = t(`sqlWorkspace.statusPill.${response.status}`);
  const statusAttributes = { 'data-testid': 'sql-status-pill', 'data-tone': tone, 'data-status': response.status };
  const statementLabel =
    statementPosition && statementPosition.total > 1
      ? t('sqlWorkspace.response.statementOf', { n: statementPosition.index, total: statementPosition.total })
      : response.statementCount > 1
        ? t('sqlWorkspace.response.statementCount', { count: response.statementCount })
        : null;
  const phases = hasRows ? response.phases : undefined;

  return (
    <ResultHeader
      workspace="sql"
      numeral={
        hasRows
          ? {
              value: `${total.lowerBound ? '≥ ' : ''}${num(total.count)}`,
              unit: t('sqlWorkspace.response.rowsUnit', { count: total.count }),
              title: statusLabel,
              attributes: statusAttributes,
            }
          : undefined
      }
      status={
        hasRows ? undefined : (
          <span {...statusAttributes}>
            <StatusBadge tone={tone} dot>
              {statusLabel}
            </StatusBadge>
          </span>
        )
      }
      meta={
        hasRows
          ? [
              `${Math.max(0, Math.round(response.durationMs))} ms`,
              ...(shownInView !== null ? [t('sqlWorkspace.response.shownInView', { shown: num(shownInView) })] : []),
            ].join(' · ')
          : undefined
      }
      metaTrailing={
        statementLabel !== null ? <span data-testid="sql-result-preview-statement-count"> · {statementLabel}</span> : undefined
      }
      phases={phases ? sqlPhaseSplit(phases, t) : undefined}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      actions={
        grid
          ? [
              {
                id: 'filter',
                glyph: 'filter',
                label: t('sqlWorkspace.grid.filterToggle'),
                pressed: grid.filterShown,
                onClick: grid.onToggleFilter,
                testId: 'sql-result-filter-toggle',
              },
              {
                id: 'export',
                glyph: 'export',
                label: t('sqlWorkspace.export.open'),
                onClick: grid.onExport,
                testId: 'sql-result-preview-export',
              },
            ]
          : undefined
      }
      trailing={
        grid ? (
          <button
            type="button"
            aria-pressed={grid.railShown}
            onClick={grid.onToggleRail}
            data-testid="sql-column-rail-toggle"
            title={t('sqlWorkspace.rail.toggle')}
            className={cn(
              'focus-ring inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-caption transition-colors',
              grid.railShown ? 'bg-bg-panel-alt text-fg-base' : 'text-fg-muted hover:text-fg-base'
            )}
          >
            <Columns3 size={12} aria-hidden="true" />
            {t('sqlWorkspace.rail.label')}
          </button>
        ) : undefined
      }
    />
  );
}

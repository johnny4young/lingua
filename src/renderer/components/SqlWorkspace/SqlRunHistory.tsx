/**
 * SQL workspace USABILITY upgrade — compact run-history list.
 *
 * Lists the recent runs for the active query (the per-query LRU in
 * `workspaceSqlStore.responsesByQueryId`, newest-first). Each entry is
 * a button showing a status badge + row count + duration + a relative
 * timestamp; clicking it selects that run so the result grid renders
 * its snapshot. Only the newest entry retains its `rows` preview (the
 * store trims older entries to metadata-only); selecting an older entry
 * still surfaces status / rows / duration even though its grid is empty.
 *
 * Token-only visuals (Signal-Slate). All copy resolves through `t()`.
 */

import { useTranslation } from 'react-i18next';
import type {
  SqlQueryStatus,
  SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import { cn } from '../../utils/cn';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';

function toneForStatus(status: SqlQueryStatus): StatusBadgeTone {
  if (status === 'success') return 'success';
  if (status === 'sql-error') return 'error';
  if (status === 'timeout' || status === 'too-large') return 'warning';
  return 'neutral';
}

/**
 * Format an ISO timestamp into a short `HH:MM:SS` clock for the
 * history row. Locale-aware via `toLocaleTimeString`; falls back to
 * the raw ISO string if parsing fails.
 */
function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export interface SqlRunHistoryProps {
  /** Per-query response LRU, newest-first. */
  responses: ReadonlyArray<SqlResponseV1>;
  /**
   * Index of the run currently shown in the grid. `0` is the newest.
   * Drives the active highlight.
   */
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SqlRunHistory({
  responses,
  selectedIndex,
  onSelect,
}: SqlRunHistoryProps) {
  const { t } = useTranslation();
  if (responses.length <= 1) return null;

  return (
    <section
      data-testid="sql-run-history"
      className="shrink-0 border-t border-border-subtle bg-bg-panel"
    >
      <header className="px-3 py-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-fg-subtle">
          {t('sqlWorkspace.history.label')}
        </span>
      </header>
      <ul
        role="list"
        className="max-h-[18vh] overflow-y-auto px-1.5 pb-1.5"
        aria-label={t('sqlWorkspace.history.ariaLabel')}
      >
        {responses.map((entry, index) => {
          const tone = toneForStatus(entry.status);
          const isActive = index === selectedIndex;
          const hasRows =
            entry.status === 'success' || entry.status === 'too-large';
          return (
            <li key={`${entry.recordedAt}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                data-testid="sql-run-history-entry"
                data-active={isActive}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1 text-left text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  isActive
                    ? 'border-l-accent bg-bg-inset text-fg-base'
                    : 'border-l-transparent text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base'
                )}
              >
                <StatusBadge tone={tone} dot>
                  {t(`sqlWorkspace.statusPill.${entry.status}`)}
                </StatusBadge>
                {hasRows ? (
                  <span className="font-mono tabular-nums text-fg-subtle">
                    {t('sqlWorkspace.response.rowCount', {
                      count: entry.rowCount,
                    })}
                  </span>
                ) : null}
                <span className="ml-auto flex items-center gap-2 font-mono text-[10px] tabular-nums text-fg-subtle">
                  <span>{Math.max(0, Math.round(entry.durationMs))} ms</span>
                  <span>{formatClock(entry.recordedAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

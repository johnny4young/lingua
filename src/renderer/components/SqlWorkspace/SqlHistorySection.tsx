import { ChevronDown, ChevronRight, History, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterSqlHistory, type SqlHistoryEntryV1 } from '../../../shared/sqlHistory';
import { cn } from '../../utils/cn';
import { toneForSqlStatus } from './sqlStatusTone';
import { formatClock } from './sqlResultFormatters';

const DOT_CLASS: Partial<Record<ReturnType<typeof toneForSqlStatus>, string>> = {
  success: 'bg-success-fg',
  error: 'bg-error-fg',
  warning: 'bg-warning-fg',
};

/**
 * The runs of the active connection (Local when unset), newest first; a
 * click opens its SQL in a new scratch on that connection without running it.
 */
export function SqlHistorySection({
  entries: allEntries,
  connectionId,
  connectionLabel,
  open,
  onToggle,
  onOpenEntry,
  onClear,
}: {
  entries: ReadonlyArray<SqlHistoryEntryV1>;
  connectionId?: string;
  /** Named in the header when connections are on. */
  connectionLabel?: string;
  open: boolean;
  onToggle: () => void;
  onOpenEntry: (entry: SqlHistoryEntryV1) => void;
  /** Clears the runs shown here. */
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const entries = useMemo(() => filterSqlHistory(allEntries, '', connectionId), [allEntries, connectionId]);
  const visible = useMemo(() => filterSqlHistory(entries, search, connectionId), [entries, search, connectionId]);

  return (
    <div data-testid="sql-history-section" className="flex flex-col border-t border-border-subtle bg-bg-panel">
      <header className="flex h-[26px] items-center gap-1.5 pl-1.5 pr-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          data-testid="sql-history-toggle"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
          <History size={11} aria-hidden="true" className="text-fg-subtle" />
          <span className="font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
            {t('sqlWorkspace.history.label')}
          </span>
          {connectionLabel ? (
            <span data-testid="sql-history-connection" className="min-w-0 truncate font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
              · {connectionLabel}
            </span>
          ) : null}
          <span data-testid="sql-history-count" className="font-mono text-micro tabular-nums text-fg-subtle">
            {entries.length}
          </span>
        </button>
        {open && entries.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('sqlWorkspace.history.clearConfirm'))) onClear();
            }}
            aria-label={t('sqlWorkspace.history.clear')}
            title={t('sqlWorkspace.history.clear')}
            data-testid="sql-history-clear"
            className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-panel-alt hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {open ? (
        <div className="px-1.5 pb-1.5">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('sqlWorkspace.history.search')}
            aria-label={t('sqlWorkspace.history.search')}
            data-testid="sql-history-search"
            className="mb-1 h-[22px] w-full rounded-md border border-border-default bg-bg-inset px-2 text-body-sm text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
          <ul role="list" aria-label={t('sqlWorkspace.history.label')}>
            {visible.length === 0 ? (
              <li className="px-1 py-1 text-caption text-fg-subtle">
                {t(entries.length === 0 ? 'sqlWorkspace.history.empty' : 'sqlWorkspace.history.noMatch')}
              </li>
            ) : null}
            {visible.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onOpenEntry(entry)}
                  title={entry.sql}
                  data-testid="sql-history-row"
                  data-status={entry.status}
                  className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 text-left hover:bg-bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[toneForSqlStatus(entry.status)] ?? 'bg-fg-subtle')}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-caption text-fg-base">
                      {entry.sql.replace(/\s+/g, ' ').trim()}
                    </span>
                  </span>
                  <span className="truncate pl-3 font-mono text-micro tabular-nums text-fg-subtle">
                    {t('sqlWorkspace.history.meta', {
                      time: formatClock(entry.recordedAt),
                      duration: Math.round(entry.durationMs),
                      status: t(`sqlWorkspace.statusPill.${entry.status}`),
                      count: entry.rowCount,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

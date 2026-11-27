import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { usePortalMenu } from '../../hooks/usePortalMenu';
import { formatNumber } from '../../i18n/formatNumber';
import { cn } from '../../utils/cn';
import { maxDuration } from '../../utils/latencyScale';
import { SqlLatencyBar } from './SqlLatencyBar';
import { formatClock } from './sqlResultFormatters';
import { sqlStatusDotClass, toneForSqlStatus } from './sqlStatusTone';

/**
 * Which run of the query the result shows, named by its time; the menu lists
 * the query's recent runs, newest first, in the history's grammar.
 */
export function SqlRunPicker({
  responses,
  selectedIndex,
  onSelect,
}: {
  /** The query's runs, newest first. */
  responses: ReadonlyArray<SqlResponseV1>;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const { open, setOpen, triggerRef, menuRef, position, onMenuKeyDown, closeToTrigger } = usePortalMenu();
  const slowest = useMemo(() => maxDuration(responses.map((entry) => entry.durationMs)), [responses]);

  const shown = responses[selectedIndex];
  if (!shown) return null;
  const label = t('sqlWorkspace.history.ariaLabel');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        data-testid="sql-run-picker"
        data-latest={selectedIndex === 0 ? 'true' : 'false'}
        className={cn(
          'focus-ring -my-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-bg-panel-alt hover:text-fg-base',
          selectedIndex > 0 && 'text-accent-fg'
        )}
      >
        <span className="sr-only">{label}: </span>
        {formatClock(shown.recordedAt, i18n.language)}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              data-testid="sql-run-picker-menu"
              onKeyDown={onMenuKeyDown}
              style={position}
              className="dropdown-rich z-[1000] w-max max-w-[calc(100vw-16px)]"
            >
              {responses.map((entry, index) => {
                const tone = toneForSqlStatus(entry.status);
                const hasRows = entry.status === 'success' || entry.status === 'too-large';
                return (
                  <button
                    key={`${entry.recordedAt}-${index}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={index === selectedIndex}
                    data-testid="sql-run-picker-entry"
                    data-status={entry.status}
                    onClick={() => {
                      closeToTrigger();
                      onSelect(index);
                    }}
                    className={cn(
                      'dropdown-rich-row flex w-full items-center gap-2.5 font-mono text-caption tabular-nums',
                      index === selectedIndex && 'bg-bg-panel-alt'
                    )}
                  >
                    <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', sqlStatusDotClass(entry.status))} />
                    <span className="text-fg-base">{formatClock(entry.recordedAt, i18n.language)}</span>
                    <SqlLatencyBar durationMs={entry.durationMs} maxMs={slowest} failed={tone === 'error'} />
                    <span className="ml-auto pl-3 text-fg-subtle">
                      {hasRows
                        ? t('sqlWorkspace.response.rowCount', {
                            count: entry.rowCount,
                            formatted: formatNumber(entry.rowCount, i18n.language),
                          })
                        : t(`sqlWorkspace.statusPill.${entry.status}`)}
                      {' · '}
                      {Math.max(0, Math.round(entry.durationMs))} ms
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

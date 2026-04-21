import { History } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { IconButton } from '../ui/chrome';

interface ExecutionHistoryPopoverProps {
  /**
   * Called when the user picks an entry's "Re-run" affordance. The caller
   * decides how to map a history row back onto the currently open workspace
   * (today: focus an open tab in the same language, then dispatch Run).
   */
  onRerun?: (entry: ExecutionHistoryEntry) => void;
  enabled?: boolean;
  onBlocked?: () => void;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 10) return `${durationMs.toFixed(1)} ms`;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatRelative(
  timestamp: number,
  now: number,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return t('executionHistory.relative.seconds', { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('executionHistory.relative.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  return t('executionHistory.relative.hours', { count: hours });
}

export function ExecutionHistoryPopover({
  onRerun,
  enabled = true,
  onBlocked,
}: ExecutionHistoryPopoverProps) {
  const { t } = useTranslation();
  const entries = useExecutionHistoryStore((state) => state.entries);
  const clear = useExecutionHistoryStore((state) => state.clear);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Refresh relative timestamps every 30s while the popover is visible — the
  // store itself never changes purely because of clock drift, so we drive
  // re-renders from an explicit tick instead of reading `Date.now()` during
  // render (which would cause infinite re-renders under React's strict mode).
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [open]);

  // Dismiss on outside click or Escape — standard popover hygiene, same
  // pattern the other lightweight dropdowns in the shell use.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleRerun = useCallback(
    (entry: ExecutionHistoryEntry) => {
      onRerun?.(entry);
      setOpen(false);
    },
    [onRerun]
  );

  const handleToggle = () => {
    if (!enabled) {
      onBlocked?.();
      return;
    }
    setOpen((current) => !current);
  };

  const hasEntries = entries.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        onClick={handleToggle}
        tooltip={enabled ? t('executionHistory.toggle') : t('executionHistory.lockedTooltip')}
        aria-expanded={enabled ? open : false}
        aria-disabled={enabled ? undefined : true}
        aria-haspopup="dialog"
        aria-controls={enabled && open ? popoverId : undefined}
        data-testid="execution-history-toggle"
      >
        <History size={13} />
      </IconButton>
      {enabled && open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t('executionHistory.title')}
          data-testid="execution-history-popover"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(22rem,90vw)] overflow-hidden rounded-[1.2rem] border border-border/80 bg-background-elevated/96 shadow-[0_24px_55px_rgba(12,12,16,0.35)]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
            <span className="panel-title">{t('executionHistory.title')}</span>
            {hasEntries ? (
              <button
                type="button"
                onClick={() => clear()}
                data-testid="execution-history-clear"
                className="text-[11px] uppercase tracking-[0.14em] text-muted hover:text-foreground"
              >
                {t('executionHistory.clear')}
              </button>
            ) : null}
          </header>

          {!hasEntries ? (
            <p className="px-4 py-6 text-sm text-muted" data-testid="execution-history-empty">
              {t('executionHistory.empty')}
            </p>
          ) : (
            <ul className="max-h-[18rem] overflow-y-auto">
              {[...entries].reverse().map((entry) => (
                <li
                  key={entry.id}
                  data-testid="execution-history-entry"
                  className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 last:border-b-0"
                >
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                      {entry.language}
                    </span>
                    <span className="text-sm text-foreground">
                      {t('executionHistory.entry.durationMs', {
                        value: formatDuration(entry.durationMs),
                      })}
                      {entry.status === 'error' ? (
                        <span className="ml-2 text-danger">
                          · {t('executionHistory.entry.failed')}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[11px] text-muted">
                      {formatRelative(entry.timestamp, now, t)}
                    </span>
                  </div>
                  {onRerun ? (
                    <button
                      type="button"
                      onClick={() => handleRerun(entry)}
                      data-testid="execution-history-rerun"
                      aria-label={t('executionHistory.rerun.aria', {
                        language: entry.language,
                      })}
                      className="rounded-[0.75rem] border border-border/80 px-3 py-1.5 text-xs text-muted hover:border-border-strong/90 hover:text-foreground"
                    >
                      {t('executionHistory.rerun.label')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

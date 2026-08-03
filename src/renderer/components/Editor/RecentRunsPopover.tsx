import { Check, Pin, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResultStore } from '../../stores/resultStore';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { useRunner } from '../../hooks/useRunner';
import { useTelemetry } from '../../hooks/useTelemetry';
import { replayHistoryEntry } from '../../utils/replayHistoryEntry';
import { cn } from '../../utils/cn';
import type { RecentRunsPopoverProps } from './recentRunsPopoverLoader';

const MAX_VISIBLE_ENTRIES = 8;

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
  if (seconds < 60) {
    return t('executionHistory.relative.seconds', { count: seconds });
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return t('executionHistory.relative.minutes', { count: minutes });
  }
  const hours = Math.round(minutes / 60);
  return t('executionHistory.relative.hours', { count: hours });
}

export function RecentRunsPopover({ entries, onClose }: RecentRunsPopoverProps) {
  const { t } = useTranslation();
  const togglePin = useExecutionHistoryStore(state => state.togglePin);
  const isManualRunning = useResultStore(state => state.isManualRunning);
  const isAutoRunning = useResultStore(state => state.isAutoRunning);
  const { run } = useRunner();
  const { track } = useTelemetry();
  const [now, setNow] = useState(() => Date.now());

  const visibleEntries = useMemo(() => entries.slice(0, MAX_VISIBLE_ENTRIES), [entries]);

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, []);

  const handleReplay = useCallback(
    (entry: ExecutionHistoryEntry) => {
      const isRunning = isManualRunning || isAutoRunning;
      const dispatched = replayHistoryEntry(entry, { isRunning, run });
      if (dispatched) {
        track('runtime.history_replay', {
          language: entry.language,
          status: entry.status,
          surface: 'tab_pill',
        });
      }
      onClose();
    },
    [isManualRunning, isAutoRunning, onClose, run, track]
  );

  return (
    <div
      role="dialog"
      aria-label={t('executionHistory.tabPill.popoverTitle')}
      data-testid="recent-runs-popover"
      className="surface-panel-strong absolute right-4 top-[calc(100%+0.55rem)] z-20 w-[min(20rem,calc(100%-2rem))] p-2"
    >
      <header className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">
          {t('executionHistory.tabPill.popoverTitle')}
        </span>
        <span className="text-eyebrow text-muted">
          {t('executionHistory.tabPill.count', { count: entries.length })}
        </span>
      </header>
      <ul className="flex flex-col gap-1" data-testid="recent-runs-popover-list">
        {visibleEntries.map(entry => {
          const replayDisabled = entry.snapshot === null;
          return (
            <li
              key={entry.id}
              data-testid={`recent-runs-popover-row-${entry.id}`}
              className="flex items-center gap-2 rounded-lg border border-border/40 bg-background-elevated/40 px-2 py-1.5 text-body-sm"
            >
              <span
                aria-hidden="true"
                className={
                  entry.status === 'ok'
                    ? 'inline-flex h-4 w-4 items-center justify-center rounded-full bg-success/20 text-success'
                    : 'inline-flex h-4 w-4 items-center justify-center rounded-full bg-error/20 text-error'
                }
              >
                {entry.status === 'ok' ? <Check size={10} /> : <X size={10} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{entry.language}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {formatDuration(entry.durationMs)}
              </span>
              <span className="shrink-0 text-eyebrow text-muted">
                {formatRelative(entry.timestamp, now, t)}
              </span>
              <button
                type="button"
                data-testid={`recent-runs-popover-pin-${entry.id}`}
                aria-pressed={entry.pinned === true}
                title={
                  entry.pinned
                    ? t('executionHistory.tabPill.unpin')
                    : t('executionHistory.tabPill.pin')
                }
                onClick={() => togglePin(entry.id)}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface',
                  entry.pinned ? 'text-primary' : 'text-muted'
                )}
              >
                <Pin
                  size={11}
                  aria-hidden="true"
                  className={entry.pinned ? 'fill-current' : undefined}
                />
              </button>
              <button
                type="button"
                data-testid={`recent-runs-popover-replay-${entry.id}`}
                disabled={replayDisabled}
                aria-disabled={replayDisabled}
                title={
                  replayDisabled
                    ? t('executionHistory.tabPill.replayUnavailable')
                    : t('executionHistory.tabPill.replayAction')
                }
                onClick={() => handleReplay(entry)}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-surface',
                  replayDisabled ? 'cursor-not-allowed text-muted opacity-50' : 'text-primary'
                )}
              >
                <RotateCw size={11} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

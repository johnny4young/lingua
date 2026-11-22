/**
 * Recent responses for the active request, newest first, from
 * `workspaceToolStore.responsesByRequestId`. Each row reads as an
 * instrument: a status dot, the code, and a latency bar on a square-root
 * scale shared by the list. Older entries lost their body to the store
 * LRU, so selecting one shows its status and timing only.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { cn } from '../../utils/cn';
import { latencyShare, maxDuration } from '../../utils/latencyScale';
import { formatWholeDuration } from '../../utils/timeLabels';
import { isTransportFailure, labelForResponse, toneForResponse } from './httpStatus';
import './httpInstruments.css';

const BAR_WIDTH = 72;

/** The status pill's tone in three: error for 4xx, 5xx and too large, neutral for no status at all. */
function historyTone(entry: HttpResponseV1): 'ok' | 'error' | 'neutral' {
  const tone = toneForResponse(entry);
  return tone === 'neutral' ? 'neutral' : tone === 'warning' || tone === 'error' ? 'error' : 'ok';
}

export interface HttpResponseHistoryProps {
  history: ReadonlyArray<HttpResponseV1>;
  /** Index of the currently-shown response (0 = newest). */
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Relative-time formatter scoped to the strip. Uses `Intl.RelativeTimeFormat`
 * with the active locale; falls back to a short absolute time if the
 * timestamp is unparseable.
 */
function useRelativeTime(): (iso: string) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    return (iso: string): string => {
      const then = Date.parse(iso);
      if (Number.isNaN(then)) return '';
      const deltaSec = Math.round((then - Date.now()) / 1000);
      const absSec = Math.abs(deltaSec);
      if (absSec < 60) return rtf.format(deltaSec, 'second');
      const deltaMin = Math.round(deltaSec / 60);
      if (Math.abs(deltaMin) < 60) return rtf.format(deltaMin, 'minute');
      const deltaHr = Math.round(deltaMin / 60);
      if (Math.abs(deltaHr) < 24) return rtf.format(deltaHr, 'hour');
      return rtf.format(Math.round(deltaHr / 24), 'day');
    };
  }, [i18n.language]);
}

export function HttpResponseHistory({
  history,
  selectedIndex,
  onSelect,
}: HttpResponseHistoryProps) {
  const { t } = useTranslation();
  const relative = useRelativeTime();
  const longest = useMemo(() => maxDuration(history.map((entry) => entry.durationMs)), [history]);

  // Only worth showing once there is more than one recorded response —
  // a single entry is already the live preview.
  if (history.length <= 1) return null;

  return (
    <section
      data-testid="http-response-history"
      aria-label={t('httpWorkspace.response.history.ariaLabel')}
      className="flex shrink-0 flex-col border-t border-border-subtle bg-bg-panel"
    >
      <header className="px-3 pt-2 pb-1">
        <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
          {t('httpWorkspace.response.history.label')}
        </span>
      </header>
      <ul role="list" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
        {history.map((entry, index) => {
          const isSelected = index === selectedIndex;
          const tone = historyTone(entry);
          const label = labelForResponse(entry, t);
          return (
            <li key={`${entry.recordedAt}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                data-testid="http-response-history-row"
                data-selected={isSelected}
                data-tone={tone}
                aria-current={isSelected ? 'true' : undefined}
                title={`${label} · ${relative(entry.recordedAt)}`}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left font-mono text-caption tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                  isSelected ? 'bg-bg-inset font-semibold text-fg-base' : 'text-fg-muted hover:bg-bg-inset/60 hover:text-fg-base'
                )}
              >
                <span className="http-history-dot" data-tone={tone} aria-hidden="true" />
                <span className={cn('w-12 shrink-0 truncate', tone === 'error' && 'text-error-fg')} data-testid="http-response-history-status">
                  {entry.status > 0 && !isTransportFailure(entry) ? entry.status : label}
                </span>
                <span className="flex min-w-0 flex-1 items-center" aria-hidden="true">
                  <span
                    className="http-history-bar"
                    data-tone={tone === 'error' ? 'error' : undefined}
                    data-testid="http-response-history-bar"
                    style={{ width: Math.max(3, latencyShare(entry.durationMs, longest) * BAR_WIDTH) }}
                  />
                </span>
                <span className="shrink-0 text-fg-subtle">{formatWholeDuration(entry.durationMs)}</span>
                <span className="sr-only">{`${label}, ${relative(entry.recordedAt)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

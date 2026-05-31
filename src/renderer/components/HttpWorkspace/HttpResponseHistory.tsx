/**
 * HTTP workspace usability upgrade — response history strip.
 *
 * A compact list of recent responses for the active request, read from
 * `workspaceToolStore.responsesByRequestId` (LRU, newest-first). Each
 * row shows a status badge + timing + relative timestamp; clicking it
 * selects that response for the preview. The newest entry is the one
 * the preview shows by default; older entries keep metadata but their
 * body was stripped by the store LRU, so selecting an old row shows the
 * status/timing without a body (the preview handles the empty body).
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpResponseV1 } from '../../../shared/httpWorkspace';
import { cn } from '../../utils/cn';
import { HttpStatusPill } from './HttpStatusPill';

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
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
          {t('httpWorkspace.response.history.label')}
        </span>
      </header>
      <ul role="list" className="flex max-h-28 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
        {history.map((entry, index) => {
          const isSelected = index === selectedIndex;
          return (
            <li key={`${entry.recordedAt}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                data-testid="http-response-history-row"
                data-selected={isSelected}
                aria-current={isSelected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                  isSelected
                    ? 'border-l-accent bg-bg-inset text-fg-base'
                    : 'border-l-transparent text-fg-muted hover:bg-bg-inset/60 hover:text-fg-base'
                )}
              >
                <HttpStatusPill response={entry} />
                <span className="font-mono tabular-nums text-fg-subtle">
                  {entry.durationMs} ms
                </span>
                <span className="ml-auto shrink-0 text-[10.5px] text-fg-subtle">
                  {relative(entry.recordedAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

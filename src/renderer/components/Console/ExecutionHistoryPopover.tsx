import { History } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { useEditorStore } from '../../stores/editorStore';
import { IconButton } from '../ui/chrome';

interface ExecutionHistoryPopoverProps {
  /**
   * Called when the user picks an entry's Replay affordance. The caller owns
   * creating the snapshot tab and dispatching the run without extending the
   * history timeline.
   */
  onRerun?: (entry: ExecutionHistoryEntry) => void;
  /**
   * Called when the user has selected exactly two snapshot-bearing entries
   * and pressed Compare. The popover hands the entries up sorted oldest →
   * newest so the comparison surface can render them deterministically. The
   * popover closes and the multiselect resets after the callback fires.
   */
  onCompare?: (older: ExecutionHistoryEntry, newer: ExecutionHistoryEntry) => void;
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

function parseEntryCounter(id: string): number | null {
  const suffix = id.slice(id.lastIndexOf('-') + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return Number.parseInt(suffix, 10);
}

function compareHistoryEntries(older: ExecutionHistoryEntry, newer: ExecutionHistoryEntry): number {
  if (older.timestamp !== newer.timestamp) return older.timestamp - newer.timestamp;

  const olderCounter = parseEntryCounter(older.id);
  const newerCounter = parseEntryCounter(newer.id);
  if (olderCounter !== null && newerCounter !== null && olderCounter !== newerCounter) {
    return olderCounter - newerCounter;
  }

  return older.id.localeCompare(newer.id);
}

export function ExecutionHistoryPopover({
  onRerun,
  onCompare,
  enabled = true,
  onBlocked,
}: ExecutionHistoryPopoverProps) {
  const { t } = useTranslation();
  const entries = useExecutionHistoryStore((state) => state.entries);
  const clear = useExecutionHistoryStore((state) => state.clear);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // RL-020 Slice 4 fold C — "This tab only" filter toggle. Defaults
  // off so the historical popover behavior is preserved; the user
  // opts into per-tab filtering. State stays open-scoped — closing
  // and reopening the popover resets the filter (consistent with the
  // existing selection-reset hygiene below).
  const [thisTabOnly, setThisTabOnly] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  // Apply the fold C filter at the source so every downstream
  // computation (compare candidates, list render, empty state)
  // honors it consistently.
  const visibleEntries = useMemo(() => {
    if (!thisTabOnly || !activeTabId) return entries;
    return entries.filter((entry) => entry.tabId === activeTabId);
  }, [entries, thisTabOnly, activeTabId]);
  const selectableEntryIds = useMemo(() => {
    return new Set(
      visibleEntries
        .filter((entry) => entry.snapshot !== null)
        .map((entry) => entry.id)
    );
  }, [visibleEntries]);
  const selectedEntries = useMemo(() => {
    return visibleEntries.filter(
      (entry) => selectedIds.has(entry.id) && entry.snapshot !== null
    );
  }, [visibleEntries, selectedIds]);

  // Refresh relative timestamps every 30s while the popover is visible — the
  // store itself never changes purely because of clock drift, so we drive
  // re-renders from an explicit tick instead of reading `Date.now()` during
  // render (which would cause infinite re-renders under React's strict mode).
  useEffect(() => {
    if (!open) return;
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

  // Selection is intentionally ephemeral: closing the popover clears it so
  // the next open starts fresh. Reopening with stale selection would
  // surprise the user, especially after they `Clear`ed the buffer.
  useEffect(() => {
    if (!open) {
      if (selectedIds.size > 0) {
        setSelectedIds(new Set());
      }
      // RL-020 Slice 4 fold C — also reset the per-tab filter on
      // close so a fresh open starts with the global view, matching
      // the implementer-documented contract above and avoiding the
      // surprising "empty popover" you'd otherwise see after a Clear
      // followed by reopening.
      if (thisTabOnly) {
        setThisTabOnly(false);
      }
      return;
    }
    setSelectedIds((current) => {
      const next = new Set<string>();
      for (const id of current) {
        if (selectableEntryIds.has(id)) next.add(id);
      }
      return next.size === current.size ? current : next;
    });
  }, [open, selectableEntryIds, selectedIds.size, thisTabOnly]);

  const handleRerun = useCallback(
    (entry: ExecutionHistoryEntry) => {
      onRerun?.(entry);
      setOpen(false);
    },
    [onRerun]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCompare = useCallback(() => {
    if (!onCompare) return;
    if (selectedIds.size !== 2 || selectedEntries.length !== 2) return;
    // Sort oldest → newest so the modal can render Older / Newer panes
    // deterministically. Tie-break on the numeric id suffix (it's
    // monotonic per timestamp bucket — see `nextId` in the store).
    const [older, newer] = [...selectedEntries].sort(compareHistoryEntries) as [
      ExecutionHistoryEntry,
      ExecutionHistoryEntry,
    ];
    onCompare(older, newer);
    setOpen(false);
  }, [onCompare, selectedEntries, selectedIds.size]);

  const handleClear = useCallback(() => {
    clear();
    setSelectedIds(new Set());
  }, [clear]);

  const handleToggle = () => {
    if (!enabled) {
      onBlocked?.();
      return;
    }
    setNow(Date.now());
    setOpen((current) => !current);
  };

  const hasEntries = visibleEntries.length > 0;
  // Show the fold C toggle only when there's something on the source
  // tab to filter against; otherwise checking it would surface zero
  // entries and confuse the user. Mirror the same predicate as
  // `visibleEntries` (require an explicit non-undefined `tabId`
  // matching the active tab) so the checkbox never surfaces just
  // because a legacy entry's `undefined` field happened to compare
  // truthy. Identity-equality already excludes undefined here, but
  // the explicit guard makes the intent unmissable.
  const tabHasEntries = useMemo(() => {
    if (!activeTabId) return false;
    return entries.some(
      (entry) => entry.tabId !== undefined && entry.tabId === activeTabId
    );
  }, [entries, activeTabId]);
  const compareEnabled =
    onCompare !== undefined && selectedIds.size === 2 && selectedEntries.length === 2;
  const compareDisabledHintKey = useMemo(() => {
    if (selectedIds.size === 0) return 'executionHistory.compare.button.disabled.zero';
    if (selectedIds.size === 1) return 'executionHistory.compare.button.disabled.one';
    return 'executionHistory.compare.button.disabled.tooMany';
  }, [selectedIds.size]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        onClick={handleToggle}
        tooltip={enabled ? t('executionHistory.toggle') : t('executionHistory.lockedTooltip')}
        aria-expanded={enabled ? open : false}
        aria-haspopup={enabled ? 'dialog' : undefined}
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
                onClick={handleClear}
                data-testid="execution-history-clear"
                className="text-[11px] uppercase tracking-[0.14em] text-muted hover:text-foreground"
              >
                {t('executionHistory.clear')}
              </button>
            ) : null}
          </header>

          {tabHasEntries ? (
            <label
              className="flex items-center gap-2 border-b border-border/60 bg-background-elevated/60 px-4 py-2 text-[11px] uppercase tracking-[0.08em] text-muted"
              data-testid="execution-history-this-tab-toggle"
            >
              <input
                type="checkbox"
                checked={thisTabOnly}
                onChange={(event) => setThisTabOnly(event.target.checked)}
                className="h-3 w-3"
              />
              <span>{t('executionHistory.filter.thisTabOnly')}</span>
            </label>
          ) : null}

          {!hasEntries ? (
            <p className="px-4 py-6 text-sm text-muted" data-testid="execution-history-empty">
              {thisTabOnly
                ? t('executionHistory.filter.thisTabOnly.empty')
                : t('executionHistory.empty')}
            </p>
          ) : (
            <ul className="max-h-[18rem] overflow-y-auto">
              {[...visibleEntries].reverse().map((entry) => {
                const canReplay = entry.snapshot !== null;
                const canSelect = entry.snapshot !== null;
                const checked = selectedIds.has(entry.id);

                return (
                  <li
                    key={entry.id}
                    data-testid="execution-history-entry"
                    className="grid grid-cols-[1rem_1rem_minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                  >
                    {onCompare ? (
                      <span className="flex min-h-full justify-center pt-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(entry.id)}
                          disabled={!canSelect}
                          data-testid="execution-history-compare-checkbox"
                          aria-label={t('executionHistory.compare.checkbox.aria', {
                            language: entry.language,
                          })}
                          title={
                            !canSelect
                              ? t('executionHistory.compare.checkbox.disabledNoSnapshot')
                              : undefined
                          }
                          className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-45"
                        />
                      </span>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <span className="relative flex min-h-full justify-center pt-1" aria-hidden="true">
                      <span className="absolute inset-y-[-0.75rem] w-px bg-border/60" />
                      <span
                        className={`relative h-2 w-2 rounded-full ring-2 ${
                          entry.status === 'error'
                            ? 'bg-error ring-error/15'
                            : 'bg-success ring-success/15'
                        }`}
                      />
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                        {entry.language}
                      </span>
                      <span className="text-sm text-foreground">
                        {t('executionHistory.entry.durationMs', {
                          value: formatDuration(entry.durationMs),
                        })}
                        {entry.status === 'error' ? (
                          <span className="ml-2 text-error">
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
                        disabled={!canReplay}
                        title={!canReplay ? t('executionHistory.replay.noSnapshot') : undefined}
                        data-testid="execution-history-rerun"
                        aria-label={t('executionHistory.rerun.aria', {
                          language: entry.language,
                        })}
                        className="rounded-[0.75rem] border border-border/80 px-3 py-1.5 text-xs text-muted hover:border-border-strong/90 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border/80 disabled:hover:text-muted"
                      >
                        {t('executionHistory.rerun.label')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {hasEntries && onCompare ? (
            <footer className="flex items-center justify-between gap-3 border-t border-border/80 px-4 py-3">
              <span
                data-testid="execution-history-compare-hint"
                className="text-[11px] text-muted"
              >
                {compareEnabled ? null : t(compareDisabledHintKey)}
              </span>
              <button
                type="button"
                onClick={handleCompare}
                disabled={!compareEnabled}
                data-testid="execution-history-compare"
                aria-label={
                  compareEnabled
                    ? t('executionHistory.compare.button.enabledAria')
                    : t(compareDisabledHintKey)
                }
                className="rounded-[0.75rem] border border-border/80 px-3 py-1.5 text-xs text-muted hover:border-border-strong/90 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border/80 disabled:hover:text-muted"
              >
                {t('executionHistory.compare.button.label')}
              </button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

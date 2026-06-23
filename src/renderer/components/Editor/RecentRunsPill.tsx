import { Check, History, Pin, RotateCw, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { useResultStore } from '../../stores/resultStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useRunner } from '../../hooks/useRunner';
import { replayHistoryEntry } from '../../utils/replayHistoryEntry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { trackEvent } from '../../utils/telemetry';
import { executionModeForLanguage } from '../../utils/languageMeta';
import {
  setRecentRunsPopoverOpener,
  type RecentRunsPopoverOpener,
} from '../../runtime/recentRunsPopoverBridge';
import { cn } from '../../utils/cn';

/**
 * RL-020 Slice 4 — per-tab execution-history pill.
 *
 * Renders a small status-pill button in the result-panel header that
 * lists the active tab's recent manual runs. Click opens a compact
 * popover with up to `MAX_VISIBLE_ENTRIES` rows; each row surfaces
 * language / status / duration / relative-time and a one-click Replay
 * affordance. Fold D adds a pin toggle per row so the user can keep
 * rare-but-valuable entries past the 50-entry ring buffer's eviction.
 * Fold E surfaces a Free-tier upsell pill instead of hiding the
 * surface entirely. Fold F refreshes the relative-time strings every
 * minute while the popover is open.
 */

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

export function RecentRunsPill() {
  const { t } = useTranslation();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const activeTab = useActiveTab();
  // Subscribe to the underlying `entries` array (stable reference)
  // and derive the per-tab slice via `useMemo`. Calling
  // `state.byTabId(activeTabId)` directly inside the selector
  // returns a fresh array on every snapshot read and triggers
  // React's "Maximum update depth exceeded" loop in zustand v5.
  const allEntries = useExecutionHistoryStore((state) => state.entries);
  const tabEntries = useMemo<readonly ExecutionHistoryEntry[]>(() => {
    if (!activeTabId) return [];
    return allEntries.filter((entry) => entry.tabId === activeTabId).slice().reverse();
  }, [allEntries, activeTabId]);
  const togglePin = useExecutionHistoryStore((state) => state.togglePin);
  const isManualRunning = useResultStore((state) => state.isManualRunning);
  const isAutoRunning = useResultStore((state) => state.isAutoRunning);
  const { run } = useRunner();

  const [openTabId, setOpenTabId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const visibleEntries = useMemo(
    () => tabEntries.slice(0, MAX_VISIBLE_ENTRIES),
    [tabEntries]
  );

  const language = activeTab?.language ?? 'javascript';
  const executionMode = executionModeForLanguage(language);
  const runnableSurface = executionMode === 'run';
  const canOpenRecentRuns =
    canUseExecutionHistory &&
    activeTab !== null &&
    activeTabId !== null &&
    runnableSurface &&
    tabEntries.length > 0;
  const open = activeTabId !== null && openTabId === activeTabId && canOpenRecentRuns;

  // Fold F — refresh the rendered relative-time strings every minute
  // while the popover is open. Clearing the interval on close keeps
  // the surface idle when nothing is on screen.
  useEffect(() => {
    if (!open) return;
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, [open]);

  // Outside-click + Escape to close.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      setOpenTabId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenTabId(null);
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Fold B — register a global opener so `Mod+Alt+H` can toggle the
  // popover from the keyboard shortcut dispatcher. (Moved from
  // `Mod+Shift+H` in RL-024 Slice 2 so the VSCode-parity binding maps
  // to project-replace.) Register only when
  // the pill is actually openable; otherwise the shortcut dispatcher
  // can surface its localized "no recent runs" status notice instead
  // of silently toggling invisible state.
  useEffect(() => {
    if (!canOpenRecentRuns) {
      setRecentRunsPopoverOpener(null);
      return;
    }
    const opener: RecentRunsPopoverOpener = () => {
      setNow(Date.now());
      setOpenTabId((current) => (current === activeTabId ? null : activeTabId));
    };
    setRecentRunsPopoverOpener(opener);
    return () => {
      setRecentRunsPopoverOpener(null);
    };
  }, [activeTabId, canOpenRecentRuns]);

  const handleReplay = useCallback(
    (entry: ExecutionHistoryEntry) => {
      const isRunning = isManualRunning || isAutoRunning;
      // Gate telemetry on the actual dispatch — a refused replay
      // (already-running, no-snapshot, open-failed) returns false
      // and must not inflate `runtime.history_replay` adoption.
      const dispatched = replayHistoryEntry(entry, { isRunning, run });
      if (dispatched) {
        // Fold A — telemetry. Closed-enum status + surface; redactor
        // enforces the schema on both renderer + update-server.
        void trackEvent('runtime.history_replay', {
          language: entry.language,
          status: entry.status,
          surface: 'tab_pill',
        });
      }
      setOpenTabId(null);
    },
    [isManualRunning, isAutoRunning, run]
  );

  // Fold E — Free tier upsell. The pill stays visible but shows the
  // upgrade copy; clicking uses the existing centralized upsell notice.
  if (!canUseExecutionHistory) {
    if (!activeTab || !runnableSurface) return null;
    return (
      <button
        type="button"
        data-testid="recent-runs-upsell-pill"
        title={t('executionHistory.tabPill.upsell.tooltip')}
        onClick={() => {
          pushUpsellNotice({
            messageKey: 'upsell.freeCeilingReached',
            featureLabel: t('upsell.feature.executionHistory'),
          });
          void trackEvent('feature.blocked', {
            entitlement: 'execution-history',
            tier: 'free',
          });
        }}
        className="status-pill border-border/40 bg-surface-strong/60 px-2 py-0.5 text-eyebrow font-medium uppercase tracking-[0.08em] text-muted hover:bg-surface"
      >
        <History size={11} aria-hidden="true" className="mr-1" />
        {t('executionHistory.tabPill.upsell.label')}
      </button>
    );
  }

  // Pro-tier visibility gates.
  if (!canOpenRecentRuns) return null;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        data-testid="recent-runs-pill"
        data-recent-runs-count={tabEntries.length}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('executionHistory.tabPill.tooltip')}
        title={t('executionHistory.tabPill.tooltip')}
        onClick={() => {
          setNow(Date.now());
          setOpenTabId((current) => (current === activeTabId ? null : activeTabId));
        }}
        className={cn(
          'status-pill border-border/40 bg-surface-strong/60 px-2 py-0.5 text-eyebrow font-medium uppercase tracking-[0.08em] text-muted hover:bg-surface',
          open && 'border-primary/40 text-primary'
        )}
      >
        <History size={11} aria-hidden="true" className="mr-1" />
        {t('executionHistory.tabPill.label', { count: tabEntries.length })}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('executionHistory.tabPill.popoverTitle')}
          data-testid="recent-runs-popover"
          className="surface-panel-strong absolute right-0 top-[calc(100%+0.55rem)] z-20 w-[20rem] p-2"
        >
          <header className="flex items-center justify-between gap-2 px-1 pb-2">
            <span className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">
              {t('executionHistory.tabPill.popoverTitle')}
            </span>
            <span className="text-eyebrow text-muted">
              {t('executionHistory.tabPill.count', { count: tabEntries.length })}
            </span>
          </header>
          <ul className="flex flex-col gap-1" data-testid="recent-runs-popover-list">
            {visibleEntries.map((entry) => {
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
                    {entry.status === 'ok' ? (
                      <Check size={10} />
                    ) : (
                      <X size={10} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {entry.language}
                  </span>
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
                      replayDisabled
                        ? 'cursor-not-allowed text-muted opacity-50'
                        : 'text-primary'
                    )}
                  >
                    <RotateCw size={11} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

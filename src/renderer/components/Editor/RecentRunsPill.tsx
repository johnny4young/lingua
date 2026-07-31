import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useTelemetry } from '../../hooks/useTelemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { executionModeForLanguage } from '../../utils/languageMeta';
import {
  setRecentRunsPopoverOpener,
  type RecentRunsPopoverOpener,
} from '../../runtime/recentRunsPopoverBridge';
import { cn } from '../../utils/cn';
import { RecentRunsPopoverHost } from './RecentRunsPopoverHost';

/**
 * Per-tab Recent Runs trigger and activation boundary.
 *
 * The visible count, Free upsell, and keyboard opener remain ready with the
 * result header. The row renderer, relative-time timer, pin/replay controls,
 * and their icons load only when an eligible Pro user opens the popover.
 */
export function RecentRunsPill() {
  const { t } = useTranslation();
  const { track } = useTelemetry();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const activeTabId = useEditorStore(state => state.activeTabId);
  const activeTabLanguage = useEditorStore(state => getActiveTab(state)?.language ?? null);
  // Subscribe to the underlying `entries` array (stable reference) and derive
  // the per-tab slice. Selecting `byTabId()` directly would allocate on every
  // snapshot read and loop under Zustand v5.
  const allEntries = useExecutionHistoryStore(state => state.entries);
  const tabEntries = useMemo<readonly ExecutionHistoryEntry[]>(() => {
    if (!activeTabId) return [];
    return allEntries
      .filter(entry => entry.tabId === activeTabId)
      .slice()
      .reverse();
  }, [allEntries, activeTabId]);

  const [openTabId, setOpenTabId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const runnableSurface =
    activeTabLanguage !== null && executionModeForLanguage(activeTabLanguage) === 'run';
  const canOpenRecentRuns =
    canUseExecutionHistory && activeTabId !== null && runnableSurface && tabEntries.length > 0;
  const open = activeTabId !== null && openTabId === activeTabId && canOpenRecentRuns;

  // The trigger owns dismissal so Escape, outside click, and the global
  // shortcut can close the lazy popover before or after its chunk resolves.
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

  // Register only while the pill is openable. Otherwise the shortcut layer
  // can surface its localized no-history notice instead of toggling hidden UI.
  useEffect(() => {
    if (!canOpenRecentRuns || !activeTabId) {
      setRecentRunsPopoverOpener(null);
      return;
    }
    const opener: RecentRunsPopoverOpener = () => {
      setOpenTabId(current => (current === activeTabId ? null : activeTabId));
    };
    setRecentRunsPopoverOpener(opener);
    return () => {
      setRecentRunsPopoverOpener(null);
    };
  }, [activeTabId, canOpenRecentRuns]);

  // Free users retain the discoverable upsell without downloading the Pro
  // popover implementation.
  if (!canUseExecutionHistory) {
    if (!activeTabId || !runnableSurface) return null;
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
          track('feature.blocked', {
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

  if (!canOpenRecentRuns) return null;

  return (
    <div ref={containerRef} className="inline-flex">
      <button
        type="button"
        data-testid="recent-runs-pill"
        data-recent-runs-count={tabEntries.length}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('executionHistory.tabPill.tooltip')}
        title={t('executionHistory.tabPill.tooltip')}
        onClick={() => {
          setOpenTabId(current => (current === activeTabId ? null : activeTabId));
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
        <RecentRunsPopoverHost entries={tabEntries} onClose={() => setOpenTabId(null)} />
      ) : null}
    </div>
  );
}

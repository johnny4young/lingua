import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import '../../i18n/runMeterCatalog';
import { FREE_TIER_LIMITS } from '../../../shared/entitlements';
import { useEntitlement } from '../../hooks/useEntitlement';
import { useRunStale } from '../../hooks/useRunStale';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { setRecentRunsPopoverOpener } from '../../runtime/recentRunsPopoverBridge';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useEditorStore } from '../../stores/editorStore';
import { type ExecutionHistoryEntry, useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { type TabRunLog, useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatCountdown, formatRunDuration, splitRunDuration } from '../../utils/timeLabels';
import { timeoutTooltip } from '../../utils/runTerminationCopy';
import { RecentRunsPopoverHost } from '../Editor/RecentRunsPopoverHost';
import { Glyph } from '../ui/Glyph';
import { ResultNumeral } from '../ui/answer';
import { RunDot } from '../ui/RunStateGlyph';
import type { TabRunState } from '../ui/runState';
import { RunMeterHistory } from './RunMeterHistory';
import { type MeterBar, type MeterState, meterBars, meterState } from './runMeterModel';
import './RunMeter.css';

const EMPTY_LOG: TabRunLog = { count: 0, runs: [] };

const DOT: Record<MeterState, TabRunState | 'paused' | 'idle'> = {
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  done: 'ok',
  error: 'error',
  timeout: 'error',
  stopped: 'stale',
  stale: 'stale',
};

function lineCount(text: string): number {
  let count = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
  return count;
}

type PopoverState = { tabId: string; focusId?: string } | null;

/** The same bar or shortcut closes the list; another bar moves the highlight. */
function nextPopover(current: PopoverState, tabId: string, focusId?: string): PopoverState {
  return current?.tabId === tabId && current.focusId === focusId ? null : { tabId, ...(focusId ? { focusId } : {}) };
}

/** Ticks while `active`; holds the last reading otherwise, so a pause freezes the numeral. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(handle);
  }, [active]);
  return now;
}

export interface RunMeterProps {
  tabId: string;
  /** Opens Compare; absent when Compare is unavailable. */
  onCompare?: () => void;
}

/** State, elapsed time and the session's runs of the active tab, at the left of the dock. */
export function RunMeter({ tabId, onCompare }: RunMeterProps) {
  const { t } = useTranslation();
  const { running, ranAt, deadlineAt, log } = useResultStore(
    useShallow(state => ({
      running: state.isManualRunning || state.isAutoRunning,
      ranAt: state.ranCode?.tabId === tabId ? state.ranCode.at : null,
      deadlineAt: state.runDeadlineAt,
      log: state.tabRuns[tabId] ?? EMPTY_LOG,
    }))
  );
  const pausedLine = useDebuggerStore(state => (state.pausedFrame?.tabId === tabId ? state.pausedFrame.line : null));

  const showCountdown = useSettingsStore(state => state.showTimeoutCountdown);
  const { stale } = useRunStale();
  const entitled = useEntitlement('EXECUTION_HISTORY');
  const historyCombo = useShortcutLabel('run-toggle-recent-runs');
  const allEntries = useExecutionHistoryStore(state => state.entries);
  const { tabEntries, entryByRun } = useMemo(() => {
    const entries: ExecutionHistoryEntry[] = allEntries.filter(entry => entry.tabId === tabId).reverse();
    return {
      tabEntries: entries as readonly ExecutionHistoryEntry[],
      entryByRun: new Map(entries.flatMap(entry => (entry.runNumber !== undefined ? [[entry.runNumber, entry] as const] : []))),
    };
  }, [allEntries, tabId]);

  const paused = pausedLine !== null;
  const last = log.runs.at(-1) ?? null;
  const state = meterState({ running, paused, stale, last });
  const live = state === 'running' || state === 'paused';
  const now = useClock(state === 'running');
  // Every run stamps its start on ranCode, so a meter mounted mid-run still reads from it.
  const elapsedMs = live && ranAt !== null ? Math.max(0, now - ranAt) : null;
  const number = live ? log.count + 1 : log.count;
  const numeral = splitRunDuration(live ? elapsedMs : (last?.durationMs ?? null));
  const bars = meterBars(log.runs, live && elapsedMs !== null ? { number, elapsedMs } : null);
  const countdown = state === 'running' && showCountdown && deadlineAt !== null ? formatCountdown(deadlineAt - now) : null;
  const line =
    state === 'paused' ? pausedLine : state === 'error' || state === 'timeout' ? (last?.line ?? null) : null;
  // The buffer is only scanned while a line is on show, so typing never pays for it.
  const totalLines = useEditorStore(state =>
    line === null ? 0 : lineCount(state.tabs.find(tab => tab.id === tabId)?.content ?? '')
  );
  const compareWith = live ? (last?.number ?? null) : (log.runs.at(-2)?.number ?? null);

  // Recent runs popover: the bars and Mod+Alt+H open it, fixed above the meter so the dock cannot clip it.
  const [popover, setPopover] = useState<PopoverState>(null);
  const [anchor, setAnchor] = useState<{ bottom: number; left: number } | null>(null);
  const meterRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const canOpen = tabEntries.length > 0;
  function measure() {
    const rect = meterRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ bottom: window.innerHeight - rect.top + 8, left: rect.left + 12 });
  }
  const toggle = (focusId?: string) => {
    measure();
    setPopover(current => nextPopover(current, tabId, focusId));
  };
  // Keyed by tab, so switching tabs closes the list without an effect.
  const open = popover?.tabId === tabId && canOpen;

  useEffect(() => {
    if (!canOpen) return;
    setRecentRunsPopoverOpener(() => {
      measure();
      setPopover(current => nextPopover(current, tabId));
    });
    return () => setRecentRunsPopoverOpener(null);
  }, [canOpen, tabId]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (meterRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      setPopover(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  const stateTitle = (() => {
    if (countdown) return t('runtime.statusPill.countdown.tooltip', { label: countdown });
    if (state === 'stale') return t('runState.stale.hint');
    if (state === 'stopped') return t('runtime.statusPill.stopped.tooltip');
    if (state === 'error') return t('runtime.statusPill.error.tooltip');
    if (state === 'timeout' && last) return timeoutTooltip(t, last);
    return undefined;
  })();
  // The attributes the run status pill carried, so status checks keep one selector.
  const statusKind =
    countdown !== null ? 'countdown' : state === 'error' || state === 'timeout' || state === 'stopped' ? state : null;

  const barLabel = (bar: MeterBar) =>
    bar.kind === 'ok'
      ? t('runMeter.bar.ok', { number: bar.number, duration: formatRunDuration(bar.durationMs) })
      : t(`runMeter.bar.${bar.kind}`, { number: bar.number });

  return (
    <section
      ref={meterRef}
      aria-label={t('runMeter.label')}
      data-testid="run-meter"
      data-state={state}
      className="run-meter"
    >
      <div
        className="run-meter-state"
        title={stateTitle}
        data-testid={state === 'stale' ? 'run-stale-pill' : 'run-meter-state'}
        {...(statusKind ? { 'data-result-kind': 'run-status-pill', 'data-run-status': statusKind } : {})}
        aria-live="polite"
      >
        <RunDot state={DOT[state] as TabRunState} />
        <span className="run-meter-state-name">{t(`runMeter.state.${state}`)}</span>
        {number > 0 ? <span className="run-meter-state-detail">· {t('runMeter.run', { number })}</span> : null}
        {line !== null ? (
          <span className="run-meter-state-detail">· {t('runMeter.line', { line, total: Math.max(line, totalLines) })}</span>
        ) : null}
        {countdown !== null ? <span className="run-meter-state-detail">· {t('runMeter.left', { time: countdown })}</span> : null}
        {stateTitle ? <span className="sr-only">{stateTitle}</span> : null}
      </div>
      <div className="run-meter-numeral">
        <ResultNumeral
          size="xl"
          value={numeral.value}
          unit={numeral.unit ?? undefined}
          tone={state === 'error' || state === 'timeout' ? 'error' : 'neutral'}
          {...(numeral.unit ? { 'data-testid': 'dock-execution-time' } : {})}
        />
      </div>
      {bars.length > 0 ? (
        <div className="run-meter-bars" role="group" aria-label={t('runMeter.bars')} data-testid="run-meter-bars">
          {bars.map(bar => {
            const label = barLabel(bar);
            const entry = entryByRun.get(bar.number);
            const style = {
              '--bar-height': bar.height,
              ...(bar.expected !== undefined ? { '--bar-expected': bar.expected } : {}),
            } as React.CSSProperties;
            const body = (
              <>
                <span className="run-meter-bar-track" aria-hidden>
                  {bar.expected !== undefined ? <span className="run-meter-bar-expected" /> : null}
                  <span className="run-meter-bar-fill" />
                </span>
                <span className="run-meter-bar-number" aria-hidden>
                  {bar.number}
                </span>
              </>
            );
            const shared = {
              className: 'run-meter-bar',
              'data-kind': bar.kind,
              'data-latest': bar.latest ? 'true' : undefined,
              'data-testid': 'run-meter-bar',
              style,
            };
            return canOpen ? (
              <button
                key={bar.number}
                type="button"
                {...shared}
                aria-label={t('runMeter.bar.open', { label })}
                title={historyCombo ? `${label} · ${historyCombo}` : label}
                aria-haspopup="dialog"
                aria-expanded={open && popover?.focusId === entry?.id}
                onClick={() => toggle(entry?.id)}
              >
                {body}
              </button>
            ) : (
              <span key={bar.number} role="img" {...shared} aria-label={label} title={label}>
                {body}
              </span>
            );
          })}
        </div>
      ) : null}
      {number > 0 || allEntries.length > 0 ? (
        <div className="run-meter-foot">
          <RunMeterHistory label={t('runMeter.runs', { count: number })} />
          {onCompare && compareWith !== null ? (
            <button
              type="button"
              className="run-meter-link run-meter-compare"
              data-testid="run-meter-compare"
              aria-label={t('runMeter.compareWith', { number: compareWith })}
              title={t('runMeter.compareWith', { number: compareWith })}
              onClick={onCompare}
            >
              <Glyph name="compare" size={13} />
              <span className="run-meter-compare-label">{t('runMeter.compareWith', { number: compareWith })}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {open && anchor
        ? createPortal(
            <div ref={popoverRef} className="fixed z-50" style={{ bottom: anchor.bottom, left: anchor.left }}>
              <RecentRunsPopoverHost
                entries={entitled ? tabEntries : tabEntries.slice(0, FREE_TIER_LIMITS.recentRuns)}
                {...(entitled ? {} : { sliceOf: tabEntries.length })}
                {...(popover?.focusId ? { focusId: popover.focusId } : {})}
                onClose={() => setPopover(null)}
              />
            </div>,
            document.body
          )
        : null}
    </section>
  );
}


import {
  Bug,
  ChevronsRight,
  ChevronUp,
  ChevronDown,
  CirclePause,
  CirclePlay,
  LogOut,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { postDebuggerMessage } from '../../runtime/debuggerWorkerBridge';
import { trackEvent } from '../../utils/telemetry';
import { languageSupportsDebugger } from '../../utils/languageMeta';
import type { Language } from '../../types';
import { Tooltip } from '../ui/chrome';

const debuggerButtonBase =
  'inline-flex items-center gap-1 rounded-md border border-border/80 bg-background/70 px-2 py-1 text-xs font-medium shadow-sm shadow-black/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55';
const debuggerActionButton =
  `${debuggerButtonBase} text-foreground hover:border-primary/50 hover:bg-surface-strong/65`;
const debuggerDangerButton =
  `${debuggerButtonBase} text-muted hover:border-danger/50 hover:bg-danger/5 hover:text-danger`;

/**
 * RL-027 Slice 1 — single drawer combining the four ADR §3 panels
 * (variables, watches, call stack, toolbar) into one collapsible
 * surface. Splitting into four sub-files was originally planned but
 * folded into one to keep the renderer footprint small and the visual
 * diff smaller for review. The internal sections are clearly demarcated
 * so a Slice 1.5 split is mechanical.
 *
 * Mounts whenever:
 *   1. `debuggerEnabled` setting is true (Settings → Editor).
 *   2. There is at least one breakpoint in the active tab OR an
 *      attached session.
 *
 * Hides itself otherwise so the existing layout is undisturbed.
 *
 * Reference: docs/PLAN.md RL-027 Slice 1 and docs/DEBUGGER_ADR.md.
 */
export function DebuggerDrawer({
  activeTabId,
  activeLanguage,
}: {
  activeTabId: string | null;
  activeLanguage: Language | null | undefined;
}) {
  const { t } = useTranslation();
  // Slice 2 — debugger is baseline; the Settings master toggle is gone.
  const debuggerEnabled = true;
  const supportsDebugger = languageSupportsDebugger(activeLanguage);
  const session = useDebuggerStore((state) => state.session);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const detachSession = useDebuggerStore((state) => state.detachSession);
  const drawerCollapsed = useDebuggerStore((state) => state.drawerCollapsed);
  const toggleDrawerCollapsed = useDebuggerStore((state) => state.toggleDrawerCollapsed);
  const allBreakpoints = useDebuggerStore((state) => state.breakpoints);
  // Toolbar actions are global, even though drawer visibility and the
  // summary pill stay scoped to the active editor tab.
  const allBreakpointCount = Object.keys(allBreakpoints).length;
  const allBreakpointsDisabled =
    allBreakpointCount > 0 &&
    Object.values(allBreakpoints).every((bp) => bp.enabled === false);
  const clearAllBreakpoints = useDebuggerStore((state) => state.clearAllBreakpoints);
  const setAllBreakpointsEnabled = useDebuggerStore(
    (state) => state.setAllBreakpointsEnabled
  );
  const breakpointCount = useDebuggerStore((state) => {
    if (!activeTabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === activeTabId) count += 1;
    }
    return count;
  });
  const enabledBreakpointCount = useDebuggerStore((state) => {
    if (!activeTabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === activeTabId && bp.enabled !== false) count += 1;
    }
    return count;
  });

  // Keep unsupported languages and tabs with no debugger state from
  // resizing the editor layout.
  if (!debuggerEnabled || !supportsDebugger) return null;
  if (!session && breakpointCount === 0) return null;

  const isPaused = Boolean(pausedFrame);
  const reasonKey = pausedFrame
    ? `debugger.paused.reason.${pausedFrame.reason}`
    : '';
  const idleCopyKey =
    breakpointCount > 0 && enabledBreakpointCount === 0
      ? 'debugger.empty.noEnabled'
      : 'debugger.empty.ready';
  // Some runtimes can pause without stack metadata; do not expose a
  // step-out action that the worker cannot satisfy.
  const canStepOut = isPaused && (pausedFrame?.callStack.length ?? 0) > 0;
  const breakpointSummary =
    breakpointCount > 0
      ? t('debugger.breakpoints.summary', {
          enabled: enabledBreakpointCount,
          count: breakpointCount,
        })
      : t('debugger.breakpoints.empty');
  const breakpointSummaryHint =
    breakpointCount > 0
      ? t('debugger.breakpoints.summaryHint', {
          enabled: enabledBreakpointCount,
          count: breakpointCount,
          global: allBreakpointCount,
        })
      : t('debugger.breakpoints.emptyHint');
  const statusHint = isPaused
    ? t('debugger.status.pausedHint')
    : t('debugger.status.readyHint');
  const toggleBreakpointsHint =
    allBreakpointCount === 0
      ? t('debugger.breakpoints.emptyHint')
      : allBreakpointsDisabled
        ? t('debugger.breakpoints.enableAll.hint')
        : t('debugger.breakpoints.disableAll.hint');
  const clearBreakpointsHint =
    allBreakpointCount === 0
      ? t('debugger.breakpoints.emptyHint')
      : t('debugger.breakpoints.clearAll.hint');

  const sendResume = () => {
    postDebuggerMessage({ type: 'resume' });
    // Optimistically clear the pause state so stale variables/callstack
    // are not shown while the worker resumes execution.
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const sendStep = (mode: 'over' | 'into' | 'out') => {
    postDebuggerMessage({ type: 'step', mode });
    // A step command immediately invalidates the current frame; the
    // worker will publish a fresh pause frame if execution stops again.
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const detach = () => {
    // RL-027 Slice 1.5 fold E — emit a `debugger.detached` event with
    // `reasonBucket='user-detach'`. The runners emit their own
    // `run-complete` / `crash` / `stop` reasons; this branch covers the
    // explicit user-initiated detach via the drawer button.
    const language = session?.runtime ?? 'js';
    void trackEvent('debugger.detached', { language, reasonBucket: 'user-detach' });
    postDebuggerMessage({ type: 'set-breakpoints', breakpoints: [] });
    postDebuggerMessage({ type: 'resume' });
    useDebuggerStore.getState().setPausedFrame(null);
    detachSession();
  };
  const toggleAllBreakpoints = () => {
    // Bulk enable/disable intentionally spans every tab so a hidden
    // breakpoint cannot keep surprising future runs.
    setAllBreakpointsEnabled(allBreakpointsDisabled);
  };
  const clearBreakpoints = () => {
    if (window.confirm(t('debugger.breakpoints.clearAll.confirm'))) {
      clearAllBreakpoints();
    }
  };

  return (
    <section
      data-testid="debugger-drawer"
      className={`flex h-full min-h-0 flex-col bg-background/55 ${
        isPaused ? 'border-danger/45' : 'border-border/80'
      }`}
    >
      <header className="flex flex-col gap-2 px-4 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Tooltip
            content={
              drawerCollapsed
                ? t('debugger.drawer.expandHint')
                : t('debugger.drawer.collapseHint')
            }
          >
            <button
              type="button"
              data-testid="debugger-collapse"
              onClick={toggleDrawerCollapsed}
              aria-label={
                drawerCollapsed ? t('debugger.drawer.expand') : t('debugger.drawer.collapse')
              }
              aria-expanded={!drawerCollapsed}
              aria-controls="debugger-drawer-body"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {drawerCollapsed ? (
                <ChevronUp size={11} aria-hidden="true" />
              ) : (
                <ChevronDown size={11} aria-hidden="true" />
              )}
            </button>
          </Tooltip>
          <Bug size={14} aria-hidden="true" />
          <span>{t('debugger.title')}</span>
          <Tooltip content={breakpointSummaryHint}>
            <span
              data-testid="debugger-breakpoint-summary"
              className={`status-pill border-transparent px-2 py-0.5 text-[10px] ${
                enabledBreakpointCount > 0 ? 'bg-danger/10 text-danger' : 'bg-surface text-muted'
              }`}
            >
              {breakpointSummary}
            </span>
          </Tooltip>
          <Tooltip content={statusHint}>
            <span
              className={`status-pill border-transparent px-2 py-0.5 text-[10px] ${
                isPaused ? 'bg-danger/12 text-danger' : 'bg-surface text-muted'
              }`}
            >
              {isPaused ? t('debugger.status.paused') : t('debugger.status.ready')}
            </span>
          </Tooltip>
          {isPaused && pausedFrame ? (
            <span className="text-xs font-normal text-muted">
              ·{' '}
              {t('debugger.paused.heading', {
                line: pausedFrame.line,
                reason: t(reasonKey),
              })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Tooltip content={toggleBreakpointsHint}>
            <button
              type="button"
              data-testid="debugger-toggle-all-breakpoints"
              onClick={toggleAllBreakpoints}
              disabled={allBreakpointCount === 0}
              className={debuggerDangerButton}
            >
              {allBreakpointsDisabled ? (
                <CirclePlay size={11} aria-hidden="true" />
              ) : (
                <CirclePause size={11} aria-hidden="true" />
              )}
              {allBreakpointsDisabled
                ? t('debugger.breakpoints.enableAll.button')
                : t('debugger.breakpoints.disableAll.button')}
            </button>
          </Tooltip>
          <Tooltip content={clearBreakpointsHint}>
            <button
              type="button"
              data-testid="debugger-clear-all-breakpoints"
              onClick={clearBreakpoints}
              disabled={allBreakpointCount === 0}
              className={debuggerDangerButton}
            >
              <Trash2 size={11} aria-hidden="true" />
              {t('debugger.breakpoints.clearAll.button')}
            </button>
          </Tooltip>
          <Tooltip content={t('debugger.actions.continueHint')}>
            <button
              type="button"
              data-testid="debugger-continue"
              onClick={sendResume}
              disabled={!isPaused}
              className={debuggerActionButton}
            >
              <ChevronsRight size={11} aria-hidden="true" />
              {t('debugger.actions.continue')}
            </button>
          </Tooltip>
          <Tooltip content={t('debugger.actions.stepOverHint')}>
            <button
              type="button"
              data-testid="debugger-step-over"
              onClick={() => sendStep('over')}
              disabled={!isPaused}
              className={debuggerActionButton}
            >
              <ChevronDown size={11} aria-hidden="true" />
              {t('debugger.actions.stepOver')}
            </button>
          </Tooltip>
          <Tooltip content={t('debugger.actions.stepIntoHint')}>
            <button
              type="button"
              data-testid="debugger-step-into"
              onClick={() => sendStep('into')}
              disabled={!isPaused}
              className={debuggerActionButton}
            >
              <ChevronDown size={11} aria-hidden="true" />
              {t('debugger.actions.stepInto')}
            </button>
          </Tooltip>
          <Tooltip
            content={
              canStepOut
                ? t('debugger.actions.stepOutHint')
                : t('debugger.actions.stepOut.disabledHint')
            }
          >
            <button
              type="button"
              data-testid="debugger-step-out"
              onClick={() => sendStep('out')}
              disabled={!canStepOut}
              className={debuggerActionButton}
            >
              <ChevronUp size={11} aria-hidden="true" />
              {t('debugger.actions.stepOut')}
            </button>
          </Tooltip>
          <Tooltip content={t('debugger.actions.detachHint')}>
            <button
              type="button"
              data-testid="debugger-detach"
              onClick={detach}
              disabled={!session}
              className={debuggerDangerButton}
            >
              <LogOut size={11} aria-hidden="true" />
              {t('debugger.actions.detach')}
            </button>
          </Tooltip>
        </div>
      </header>
      {drawerCollapsed ? null : !isPaused ? (
        <p
          id="debugger-drawer-body"
          className="min-h-0 flex-1 px-4 pb-3 text-xs text-muted"
          data-testid="debugger-empty"
        >
          {t(idleCopyKey)}
        </p>
      ) : (
        // The branch is guarded by `isPaused`, so the non-null frame reads
        // below reflect the runtime contract instead of optional UI state.
        <div
          id="debugger-drawer-body"
          className="grid min-h-0 flex-1 gap-3 overflow-auto px-4 pb-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)]"
        >
          <DrawerSection
            title={t('debugger.paused.locals')}
            testid="debugger-locals"
          >
            {Object.keys(pausedFrame!.locals).length === 0 ? (
              <p className="text-[11px] text-muted">
                {t('debugger.paused.locals.empty')}
              </p>
            ) : (
              <ul className="grid gap-1">
                {Object.entries(pausedFrame!.locals).map(([name, value]) => (
                  <li key={name} className="font-mono text-[11px] text-foreground">
                    <span className="text-muted">{name}: </span>
                    {value}
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>
          <DrawerSection
            title={t('debugger.paused.callstack')}
            testid="debugger-callstack"
          >
            {pausedFrame!.callStack.length === 0 ? (
              <p className="text-[11px] text-muted">
                {t('debugger.paused.callstack.empty')}
              </p>
            ) : (
              <ol className="grid gap-1">
                {pausedFrame!.callStack.map((frame, index) => (
                  <li
                    key={`${frame.functionName}-${frame.line}-${index}`}
                    className="font-mono text-[11px] text-foreground"
                  >
                    {frame.functionName} <span className="text-muted">:{frame.line}</span>
                  </li>
                ))}
              </ol>
            )}
          </DrawerSection>
          <DrawerSection
            title={t('debugger.paused.watches')}
            testid="debugger-watches"
          >
            {Object.keys(pausedFrame!.watchResults).length === 0 ? (
              <p className="text-[11px] text-muted">
                {t('debugger.paused.watches.empty')}
              </p>
            ) : (
              <ul className="grid gap-1">
                {Object.entries(pausedFrame!.watchResults).map(([expr, result]) => (
                  <li key={expr} className="font-mono text-[11px] text-foreground">
                    <span className="text-muted">{expr}: </span>
                    {result.pending
                      ? t('debugger.paused.watches.pending')
                      : result.error
                        ? `error: ${result.error}`
                        : (result.value ?? '—')}
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>
        </div>
      )}
    </section>
  );
}

function DrawerSection({
  title,
  testid,
  children,
}: {
  title: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-[0.85rem] border border-border/80 bg-background/35 px-3 py-2"
    >
      <h4 className="mb-1 text-[10px] uppercase tracking-[0.2em] text-muted">{title}</h4>
      {children}
    </div>
  );
}

import { Bug, ChevronsRight, ChevronUp, ChevronDown, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { postDebuggerMessage } from '../../runtime/debuggerWorkerBridge';
import { trackEvent } from '../../utils/telemetry';
import { languageSupportsDebugger } from '../../utils/languageMeta';
import type { Language } from '../../types';

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
  const debuggerEnabled = useSettingsStore((state) => state.debuggerEnabled);
  const supportsDebugger = languageSupportsDebugger(activeLanguage);
  const session = useDebuggerStore((state) => state.session);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const detachSession = useDebuggerStore((state) => state.detachSession);
  const drawerCollapsed = useDebuggerStore((state) => state.drawerCollapsed);
  const toggleDrawerCollapsed = useDebuggerStore((state) => state.toggleDrawerCollapsed);
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
  const canStepOut = isPaused && (pausedFrame?.callStack.length ?? 0) > 0;

  const sendResume = () => {
    postDebuggerMessage({ type: 'resume' });
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const sendStep = (mode: 'over' | 'into' | 'out') => {
    postDebuggerMessage({ type: 'step', mode });
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

  return (
    <section
      data-testid="debugger-drawer"
      className={`flex h-full min-h-0 flex-col bg-background/55 ${
        isPaused ? 'border-danger/45' : 'border-border/80'
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-4 py-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <button
            type="button"
            data-testid="debugger-collapse"
            onClick={toggleDrawerCollapsed}
            aria-label={drawerCollapsed ? t('debugger.drawer.expand') : t('debugger.drawer.collapse')}
            aria-expanded={!drawerCollapsed}
            aria-controls="debugger-drawer-body"
            className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground"
          >
            {drawerCollapsed ? (
              <ChevronUp size={11} aria-hidden="true" />
            ) : (
              <ChevronDown size={11} aria-hidden="true" />
            )}
          </button>
          <Bug size={14} aria-hidden="true" />
          <span>{t('debugger.title')}</span>
          <span
            className={`status-pill border-transparent px-2 py-0.5 text-[10px] ${
              isPaused ? 'bg-danger/12 text-danger' : 'bg-surface text-muted'
            }`}
          >
            {isPaused ? t('debugger.status.paused') : t('debugger.status.ready')}
          </span>
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="debugger-continue"
            onClick={sendResume}
            disabled={!isPaused}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-foreground hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronsRight size={11} aria-hidden="true" />
            {t('debugger.actions.continue')}
          </button>
          <button
            type="button"
            data-testid="debugger-step-over"
            onClick={() => sendStep('over')}
            disabled={!isPaused}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-foreground hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDown size={11} aria-hidden="true" />
            {t('debugger.actions.stepOver')}
          </button>
          <button
            type="button"
            data-testid="debugger-step-into"
            onClick={() => sendStep('into')}
            disabled={!isPaused}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-foreground hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDown size={11} aria-hidden="true" />
            {t('debugger.actions.stepInto')}
          </button>
          <button
            type="button"
            data-testid="debugger-step-out"
            onClick={() => sendStep('out')}
            disabled={!canStepOut}
            title={!canStepOut ? t('debugger.actions.stepOut.disabledHint') : undefined}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-foreground hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronUp size={11} aria-hidden="true" />
            {t('debugger.actions.stepOut')}
          </button>
          <button
            type="button"
            data-testid="debugger-detach"
            onClick={detach}
            disabled={!session}
            title={t('debugger.actions.detachHint')}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-muted hover:border-danger/50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogOut size={11} aria-hidden="true" />
            {t('debugger.actions.detach')}
          </button>
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

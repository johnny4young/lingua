import { Bug, ChevronsRight, ChevronUp, ChevronDown, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { postDebuggerMessage } from '../../runtime/debuggerWorkerBridge';

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
export function DebuggerDrawer({ activeTabId }: { activeTabId: string | null }) {
  const { t } = useTranslation();
  const debuggerEnabled = useSettingsStore((state) => state.debuggerEnabled);
  const session = useDebuggerStore((state) => state.session);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const detachSession = useDebuggerStore((state) => state.detachSession);
  const breakpointCount = useDebuggerStore((state) => {
    if (!activeTabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === activeTabId) count += 1;
    }
    return count;
  });

  if (!debuggerEnabled) return null;
  if (!session && breakpointCount === 0) return null;

  const isPaused = Boolean(pausedFrame);
  const reasonKey = pausedFrame
    ? `debugger.paused.reason.${pausedFrame.reason}`
    : '';

  const sendResume = () => {
    postDebuggerMessage({ type: 'resume' });
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const sendStep = (mode: 'over' | 'into' | 'out') => {
    postDebuggerMessage({ type: 'step', mode });
    useDebuggerStore.getState().setPausedFrame(null);
  };
  const detach = () => {
    detachSession();
    postDebuggerMessage({ type: 'resume' });
  };

  return (
    <section
      data-testid="debugger-drawer"
      className="border-t border-border/80 bg-background/55"
    >
      <header className="flex items-center justify-between gap-2 px-4 py-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bug size={14} aria-hidden="true" />
          <span>{t('debugger.title')}</span>
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
            disabled={!isPaused}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-foreground hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronUp size={11} aria-hidden="true" />
            {t('debugger.actions.stepOut')}
          </button>
          <button
            type="button"
            data-testid="debugger-detach"
            onClick={detach}
            className="inline-flex items-center gap-1 rounded-[0.7rem] border border-border/80 px-2 py-1 text-xs font-medium text-muted hover:border-danger/50 hover:text-danger"
          >
            <LogOut size={11} aria-hidden="true" />
            {t('debugger.actions.detach')}
          </button>
        </div>
      </header>
      {!isPaused ? (
        <p className="px-4 pb-3 text-xs text-muted" data-testid="debugger-empty">
          {t('debugger.empty')}
        </p>
      ) : (
        <div className="grid gap-3 px-4 pb-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
          <DrawerSection
            title={t('debugger.paused.locals')}
            testid="debugger-locals"
          >
            {Object.keys(pausedFrame!.locals).length === 0 ? (
              <p className="text-[11px] text-muted">—</p>
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
              <p className="text-[11px] text-muted">—</p>
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
              <p className="text-[11px] text-muted">—</p>
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

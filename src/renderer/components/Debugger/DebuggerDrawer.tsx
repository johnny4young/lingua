import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/debuggerCatalog';
import { comparablePreviousPause, useDebuggerStore } from '../../stores/debuggerStore';
import { dispatchDebuggerControl } from '../../runtime/debuggerControlBridge';
import { languageSupportsDebugger } from '../../utils/languageMeta';
import { type LocalChange, localsChanges, orderedLocals } from '../../utils/debuggerLocals';
import { pausedFunctionName, stackRows } from '../../utils/debuggerStack';
import type { Language } from '../../types/language';
import { AnswerObject } from '../Answer/AnswerObject';
import { AnswerWasChip } from '../Answer/AnswerDeltaChip';
import { RunMeterStack } from '../RunMeter/RunMeterStack';
import { DebuggerBreakpointList } from './DebuggerBreakpointList';
import { DebuggerWatchList } from './DebuggerWatchList';
import { DrawerColumn } from './DrawerColumn';
import '../ui/identity.css';
import './debugger.css';

/** The Debugger tab inspects and never steps: the step HUD is the only step bar, the run meter holds the pause. */
export interface DebuggerDrawerProps {
  activeTabId: string | null;
  activeLanguage: Language | null | undefined;
}

export function DebuggerDrawer({ activeTabId, activeLanguage }: DebuggerDrawerProps) {
  const { t } = useTranslation();
  const supportsDebugger = languageSupportsDebugger(activeLanguage);
  const session = useDebuggerStore((state) => state.session);
  const pausedFrame = useDebuggerStore((state) => state.pausedFrame);
  const allBreakpoints = useDebuggerStore((state) => state.breakpoints);
  const previousLocals = useDebuggerStore((state) => comparablePreviousPause(state)?.locals);
  const watches = useDebuggerStore((state) => state.watches);
  const isPaused = pausedFrame !== null;
  const tabBreakpointCount = useDebuggerStore(
    (state) => Object.values(state.breakpoints).filter((bp) => bp.tabId === activeTabId).length
  );
  const enabledBreakpointCount = useDebuggerStore(
    (state) => Object.values(state.breakpoints).filter((bp) => bp.tabId === activeTabId && bp.enabled !== false).length
  );
  const callStack = pausedFrame?.callStack;
  const locals = pausedFrame?.locals;
  const stack = useMemo(() => (callStack ? stackRows(callStack) : []), [callStack]);
  const changes = useMemo(
    () => (locals ? localsChanges(previousLocals, locals) : new Map<string, LocalChange>()),
    [locals, previousLocals]
  );
  const rows = useMemo(
    () => (locals ? orderedLocals(previousLocals, locals) : []),
    [locals, previousLocals]
  );

  useEffect(() => {
    if (!session) return;
    dispatchDebuggerControl({
      type: 'set-breakpoints',
      breakpoints: Object.values(allBreakpoints)
        .filter(breakpoint => breakpoint.tabId === session.tabId && breakpoint.enabled)
        .map(breakpoint => ({
          line: breakpoint.line,
          mode: breakpoint.mode,
          condition: breakpoint.condition,
          logMessage: breakpoint.logMessage,
        })),
    });
  }, [allBreakpoints, session]);

  useEffect(() => {
    if (!session) return;
    dispatchDebuggerControl({
      type: 'set-watches',
      watches: watches.map(watch => watch.expression),
    });
  }, [session, watches]);

  // Keep unsupported languages and tabs with no debugger state from
  // resizing the editor layout.
  if (!supportsDebugger) return null;
  if (!session && tabBreakpointCount === 0) return null;

  const frameName = pausedFunctionName(stack);

  return (
    <section data-testid="debugger-drawer" data-paused={isPaused || undefined} className="debugger-drawer">
      {pausedFrame?.conditionError ? (
        <p className="debugger-condition-error" data-testid="debugger-condition-error">
          {t('debugger.breakpoints.conditionError', { message: pausedFrame.conditionError })}
        </p>
      ) : null}
      <div className="debugger-columns">
        <DrawerColumn
          testid="debugger-locals"
          className="debugger-column--locals"
          title={
            frameName
              ? t('debugger.locals.titleIn', { name: frameName })
              : t('debugger.paused.locals')
          }
          aside={
            changes.size > 0 ? (
              <span className="type-tag debugger-changed-count" data-testid="debugger-locals-changed">
                {t('debugger.locals.changed', { count: changes.size })}
              </span>
            ) : null
          }
        >
          {!pausedFrame ? (
            <p className="debugger-muted" data-testid="debugger-empty">
              {t(tabBreakpointCount > 0 && enabledBreakpointCount === 0 ? 'debugger.empty.noEnabled' : 'debugger.empty.ready')}
            </p>
          ) : Object.keys(pausedFrame.locals).length === 0 ? (
            <p className="debugger-muted">{t('debugger.paused.locals.empty')}</p>
          ) : (
            <ul className="debugger-rows">
              {rows.map(([name, value]) => {
                const change = changes.get(name);
                return (
                  <li key={name} className="debugger-row debugger-local" data-local={name} data-change={change?.kind}>
                    <span className="debugger-local-name">{name}</span>
                    <span className="debugger-row-value">
                      <AnswerObject text={value} role="value" language={activeLanguage ?? undefined} oneLine />
                    </span>
                    {change?.kind === 'changed' ? <AnswerWasChip value={change.before} /> : null}
                    {change?.kind === 'new' ? (
                      <span className="answer-delta debugger-new">{t('debugger.paused.locals.new')}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {stack.length > 0 ? (
            <RunMeterStack rows={stack} className="debugger-stack-fallback" testid="debugger-callstack-narrow" />
          ) : null}
        </DrawerColumn>
        <DebuggerWatchList runtime={session?.runtime ?? null} language={activeLanguage ?? undefined} />
        <DebuggerBreakpointList activeTabId={activeTabId} activeLanguage={activeLanguage} />
      </div>
    </section>
  );
}

import { Circle, CircleDot, Diamond, MessageSquareText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MAX_BREAKPOINT_CONDITION_LENGTH,
  MAX_LOGPOINT_MESSAGE_LENGTH,
  useDebuggerStore,
  type BreakpointMode,
} from '../../stores/debuggerStore';
import type { Language } from '../../types/language';

const modeIcon = {
  pause: CircleDot,
  conditional: Diamond,
  logpoint: MessageSquareText,
} satisfies Record<BreakpointMode, typeof Circle>;

export function DebuggerBreakpointList({
  activeTabId,
  activeLanguage = 'javascript',
}: {
  activeTabId: string | null;
  activeLanguage?: Language | null;
}) {
  const { t } = useTranslation();
  const allBreakpoints = useDebuggerStore(state => state.breakpoints);
  const breakpoints = activeTabId
    ? Object.values(allBreakpoints)
        .filter(breakpoint => breakpoint.tabId === activeTabId)
        .sort((left, right) => left.line - right.line)
    : [];
  const setBreakpointEnabled = useDebuggerStore(state => state.setBreakpointEnabled);
  const setBreakpointMode = useDebuggerStore(state => state.setBreakpointMode);
  const setBreakpointCondition = useDebuggerStore(state => state.setBreakpointCondition);
  const setBreakpointLogMessage = useDebuggerStore(state => state.setBreakpointLogMessage);
  const toggleBreakpoint = useDebuggerStore(state => state.toggleBreakpoint);
  const supportsAdvancedBreakpoints =
    activeLanguage === 'javascript' || activeLanguage === 'typescript';

  if (!activeTabId || breakpoints.length === 0) {
    return <p className="text-caption text-muted">{t('debugger.breakpoints.panel.empty')}</p>;
  }

  return (
    <div className="grid gap-2">
      <ul className="grid max-h-52 gap-2 overflow-auto pr-1">
        {breakpoints.map(breakpoint => {
          const effectiveMode = supportsAdvancedBreakpoints ? breakpoint.mode : 'pause';
          const ModeIcon = modeIcon[effectiveMode];
          const modeLabel = t(`debugger.breakpoints.mode.${effectiveMode}`);
          return (
            <li
              key={`${breakpoint.tabId}:${breakpoint.line}`}
              data-testid={`debugger-breakpoint-line-${breakpoint.line}`}
              className="grid gap-2 rounded-lg border border-border/70 bg-background/55 p-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <label className="inline-flex min-w-0 flex-1 items-center gap-2 text-caption text-foreground">
                  <input
                    type="checkbox"
                    checked={breakpoint.enabled}
                    onChange={event =>
                      setBreakpointEnabled(
                        breakpoint.tabId,
                        breakpoint.line,
                        event.currentTarget.checked
                      )
                    }
                    aria-label={t('debugger.breakpoints.enabled', { line: breakpoint.line })}
                    className="accent-danger"
                  />
                  <ModeIcon size={12} className="shrink-0 text-danger" aria-hidden="true" />
                  <span className="truncate font-mono">
                    {t('debugger.breakpoints.line', { line: breakpoint.line })}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => toggleBreakpoint(breakpoint.tabId, breakpoint.line)}
                  aria-label={t('debugger.breakpoints.remove', { line: breakpoint.line })}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </div>
              {supportsAdvancedBreakpoints ? (
                <label className="grid gap-1 text-eyebrow font-medium uppercase tracking-[0.12em] text-muted">
                  {t('debugger.breakpoints.behavior')}
                  <select
                    data-testid={`debugger-breakpoint-mode-${breakpoint.line}`}
                    value={breakpoint.mode}
                    onChange={event =>
                      setBreakpointMode(
                        breakpoint.tabId,
                        breakpoint.line,
                        event.currentTarget.value as BreakpointMode
                      )
                    }
                    aria-label={t('debugger.breakpoints.behaviorForLine', {
                      line: breakpoint.line,
                    })}
                    className="field h-8 min-w-0 py-1 text-caption normal-case tracking-normal"
                  >
                    {(['pause', 'conditional', 'logpoint'] as const).map(mode => (
                      <option key={mode} value={mode}>
                        {t(`debugger.breakpoints.mode.${mode}`)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-eyebrow leading-relaxed text-muted">
                  {t('debugger.breakpoints.nativePauseOnly')}
                </p>
              )}
              {supportsAdvancedBreakpoints && breakpoint.mode === 'conditional' ? (
                <label className="grid gap-1 text-eyebrow font-medium uppercase tracking-[0.12em] text-muted">
                  {t('debugger.breakpoints.condition')}
                  <input
                    data-testid={`debugger-breakpoint-condition-${breakpoint.line}`}
                    value={breakpoint.condition}
                    onChange={event =>
                      setBreakpointCondition(
                        breakpoint.tabId,
                        breakpoint.line,
                        event.currentTarget.value
                      )
                    }
                    maxLength={MAX_BREAKPOINT_CONDITION_LENGTH}
                    placeholder={t('debugger.breakpoints.conditionPlaceholder')}
                    aria-label={t('debugger.breakpoints.conditionForLine', {
                      line: breakpoint.line,
                    })}
                    className="field h-8 min-w-0 py-1 font-mono text-caption normal-case tracking-normal"
                  />
                </label>
              ) : null}
              {supportsAdvancedBreakpoints && breakpoint.mode === 'logpoint' ? (
                <label className="grid gap-1 text-eyebrow font-medium uppercase tracking-[0.12em] text-muted">
                  {t('debugger.breakpoints.logMessage')}
                  <input
                    data-testid={`debugger-breakpoint-log-${breakpoint.line}`}
                    value={breakpoint.logMessage}
                    onChange={event =>
                      setBreakpointLogMessage(
                        breakpoint.tabId,
                        breakpoint.line,
                        event.currentTarget.value
                      )
                    }
                    maxLength={MAX_LOGPOINT_MESSAGE_LENGTH}
                    placeholder={t('debugger.breakpoints.logMessagePlaceholder')}
                    aria-label={t('debugger.breakpoints.logMessageForLine', {
                      line: breakpoint.line,
                    })}
                    className="field h-8 min-w-0 py-1 font-mono text-caption normal-case tracking-normal"
                  />
                </label>
              ) : null}
              <span className="sr-only">{modeLabel}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-eyebrow leading-relaxed text-muted">
        {t(
          supportsAdvancedBreakpoints
            ? 'debugger.breakpoints.safeExpressionHint'
            : 'debugger.breakpoints.nativeHint'
        )}
      </p>
    </div>
  );
}

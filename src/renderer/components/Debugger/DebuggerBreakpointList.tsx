import { useState } from 'react';
import { Circle, Diamond, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n/debuggerCatalog';
import {
  bpKey,
  MAX_BREAKPOINT_CONDITION_LENGTH,
  MAX_LOGPOINT_MESSAGE_LENGTH,
  useDebuggerStore,
  type BreakpointMode,
} from '../../stores/debuggerStore';
import type { Language } from '../../types/language';
import { languageSupportsBreakpointModes } from '../../utils/languageMeta';
import { DrawerColumn } from './DrawerColumn';

// The same marks as the gutter: a red dot, an amber diamond, a blue ring.
const modeIcon = {
  pause: { icon: Circle, className: 'fill-current text-danger' },
  conditional: { icon: Diamond, className: 'text-warning-fg' },
  logpoint: { icon: Circle, className: 'text-info-fg' },
} satisfies Record<BreakpointMode, { icon: typeof Circle; className: string }>;

export function DebuggerBreakpointList({
  activeTabId,
  activeLanguage = 'javascript',
}: {
  activeTabId: string | null;
  activeLanguage?: Language | null;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const allBreakpoints = useDebuggerStore(state => state.breakpoints);
  const breakpoints = activeTabId
    ? Object.values(allBreakpoints)
        .filter(breakpoint => breakpoint.tabId === activeTabId)
        .sort((left, right) => left.line - right.line)
    : [];
  const sessionOnTab = useDebuggerStore(state => state.session?.tabId === activeTabId && activeTabId !== null);
  const hits = useDebuggerStore(state => state.breakpointHits);
  const setBreakpointEnabled = useDebuggerStore(state => state.setBreakpointEnabled);
  const setBreakpointMode = useDebuggerStore(state => state.setBreakpointMode);
  const setBreakpointCondition = useDebuggerStore(state => state.setBreakpointCondition);
  const setBreakpointLogMessage = useDebuggerStore(state => state.setBreakpointLogMessage);
  const toggleBreakpoint = useDebuggerStore(state => state.toggleBreakpoint);
  const setAllBreakpointsEnabled = useDebuggerStore(state => state.setAllBreakpointsEnabled);
  const clearAllBreakpoints = useDebuggerStore(state => state.clearAllBreakpoints);
  const supportsAdvancedBreakpoints = languageSupportsBreakpointModes(activeLanguage);
  // Bulk actions span every tab so a hidden breakpoint cannot keep surprising future runs.
  const allCount = Object.keys(allBreakpoints).length;
  const allDisabled = allCount > 0 && Object.values(allBreakpoints).every(bp => bp.enabled === false);

  const clearAll = () => {
    if (window.confirm(t('debugger.breakpoints.clearAll.confirm'))) clearAllBreakpoints();
  };

  return (
    <DrawerColumn
      testid="debugger-breakpoints"
      className="debugger-column--breakpoints"
      title={t('debugger.breakpoints.panel.title')}
      aside={
        allCount > 0 ? (
          <span className="debugger-column-actions">
            <button
              type="button"
              data-testid="debugger-toggle-all-breakpoints"
              className="debugger-link"
              title={t(allDisabled ? 'debugger.breakpoints.enableAll.hint' : 'debugger.breakpoints.disableAll.hint')}
              onClick={() => setAllBreakpointsEnabled(allDisabled)}
            >
              {t(allDisabled ? 'debugger.breakpoints.enableAll.button' : 'debugger.breakpoints.disableAll.button')}
            </button>
            <button
              type="button"
              data-testid="debugger-clear-all-breakpoints"
              className="icon-button debugger-column-action"
              aria-label={t('debugger.breakpoints.clearAll.button')}
              title={t('debugger.breakpoints.clearAll.hint')}
              onClick={clearAll}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </span>
        ) : null
      }
    >
      {breakpoints.length === 0 ? (
        <p className="debugger-muted">{t('debugger.breakpoints.panel.empty')}</p>
      ) : (
        <ul className="debugger-rows">
          {breakpoints.map(breakpoint => {
            const { line } = breakpoint;
            const mode = supportsAdvancedBreakpoints ? breakpoint.mode : 'pause';
            const { icon: ModeIcon, className: modeClass } = modeIcon[mode];
            const key = bpKey(breakpoint.tabId, line);
            const open = editing === key;
            const hitCount = hits[key] ?? 0;
            const summary =
              mode === 'conditional' && breakpoint.condition.trim()
                ? t('debugger.breakpoints.ifCondition', { condition: breakpoint.condition.trim() })
                : mode === 'logpoint' && breakpoint.logMessage.trim()
                  ? t('debugger.breakpoints.logSummary', { message: breakpoint.logMessage.trim() })
                  : t(`debugger.breakpoints.mode.${mode}`);
            // Logpoint lines can also print on their own, so their count would not be honest.
            const count =
              !sessionOnTab || mode === 'logpoint' || !breakpoint.enabled
                ? null
                : hitCount > 0
                  ? t('debugger.breakpoints.hits', { count: hitCount })
                  : t('debugger.breakpoints.notReached');
            return (
              <li
                key={`${breakpoint.tabId}:${line}`}
                data-testid={`debugger-breakpoint-line-${line}`}
                data-enabled={breakpoint.enabled ? 'true' : 'false'}
                data-open={open || undefined}
                className="debugger-breakpoint"
              >
                <div className="debugger-row">
                  <label className="debugger-breakpoint-toggle" title={t('debugger.breakpoints.enabled', { line })}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={breakpoint.enabled}
                      onChange={event => setBreakpointEnabled(breakpoint.tabId, line, event.currentTarget.checked)}
                      aria-label={t('debugger.breakpoints.enabled', { line })}
                    />
                    <ModeIcon size={12} className={modeClass} aria-hidden="true" />
                  </label>
                  <span className="debugger-breakpoint-line">{line}</span>
                  <button
                    type="button"
                    className="debugger-breakpoint-summary"
                    data-testid={`debugger-breakpoint-edit-${line}`}
                    aria-expanded={open}
                    aria-controls={`debugger-breakpoint-editor-${line}`}
                    aria-label={t('debugger.breakpoints.edit', { line, summary })}
                    onClick={() => setEditing(open ? null : key)}
                  >
                    {summary}
                  </button>
                  {count ? (
                    <span className="debugger-breakpoint-count" data-hit={hitCount > 0 || undefined} data-testid={`debugger-breakpoint-count-${line}`}>
                      {count}
                    </span>
                  ) : null}
                </div>
                {open ? (
                  <div className="debugger-breakpoint-editor" id={`debugger-breakpoint-editor-${line}`}>
                    {supportsAdvancedBreakpoints ? (
                      <select
                        data-testid={`debugger-breakpoint-mode-${line}`}
                        value={breakpoint.mode}
                        onChange={event => setBreakpointMode(breakpoint.tabId, line, event.currentTarget.value as BreakpointMode)}
                        aria-label={t('debugger.breakpoints.behaviorForLine', { line })}
                        className="field h-7 min-w-0 py-0.5 text-caption"
                      >
                        {(['pause', 'conditional', 'logpoint'] as const).map(option => (
                          <option key={option} value={option}>
                            {t(`debugger.breakpoints.mode.${option}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="debugger-footnote">{t('debugger.breakpoints.nativePauseOnly')}</p>
                    )}
                    {supportsAdvancedBreakpoints && breakpoint.mode !== 'pause' ? (
                      <ExpressionInput
                        field={breakpoint.mode === 'conditional' ? 'condition' : 'log'}
                        line={line}
                        value={breakpoint.mode === 'conditional' ? breakpoint.condition : breakpoint.logMessage}
                        onChange={value =>
                          breakpoint.mode === 'conditional'
                            ? setBreakpointCondition(breakpoint.tabId, line, value)
                            : setBreakpointLogMessage(breakpoint.tabId, line, value)
                        }
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        toggleBreakpoint(breakpoint.tabId, line);
                      }}
                      aria-label={t('debugger.breakpoints.remove', { line })}
                      className="icon-button debugger-column-action"
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </DrawerColumn>
  );
}

const EXPRESSION_FIELD = {
  condition: {
    maxLength: MAX_BREAKPOINT_CONDITION_LENGTH,
    placeholder: 'debugger.breakpoints.conditionPlaceholder',
    label: 'debugger.breakpoints.conditionForLine',
  },
  log: {
    maxLength: MAX_LOGPOINT_MESSAGE_LENGTH,
    placeholder: 'debugger.breakpoints.logMessagePlaceholder',
    label: 'debugger.breakpoints.logMessageForLine',
  },
} as const;

/** A conditional breakpoint's condition or a logpoint's message. */
function ExpressionInput({
  field,
  line,
  value,
  onChange,
}: {
  field: keyof typeof EXPRESSION_FIELD;
  line: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const config = EXPRESSION_FIELD[field];
  return (
    <input
      data-testid={`debugger-breakpoint-${field}-${line}`}
      value={value}
      onChange={event => onChange(event.currentTarget.value)}
      maxLength={config.maxLength}
      placeholder={t(config.placeholder)}
      title={t('debugger.breakpoints.safeExpressionHint')}
      aria-label={t(config.label, { line })}
      className="field h-7 min-w-0 flex-1 py-0.5 font-mono text-caption"
    />
  );
}

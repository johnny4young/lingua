import { Loader2, MoveRight, Pin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatExecTime } from '../../hooks/runnerOutput';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore, type LineResult } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { executionModeForLanguage } from '../../utils/languageMeta';
import { isInlineResultLanguage } from '../../utils/languageCapabilities';
import { AutoRunGateNotice } from './AutoRunGateNotice';
import { WorkflowModeStatusPill } from './WorkflowModeStatusPill';
import { AutoLogStatusPill } from './AutoLogStatusPill';
import { RecentRunsPill } from './RecentRunsPill';
import { defaultWorkflowMode } from '../../../shared/workflowMode';

function LineResultRow({
  result,
  watchTooltip,
  watchAriaLabel,
  watchEmptyCopy,
  autoLogTooltip,
  autoLogAriaLabel,
}: {
  result: LineResult;
  watchTooltip: string;
  watchAriaLabel: string;
  watchEmptyCopy: string;
  autoLogTooltip: string;
  autoLogAriaLabel: string;
}) {
  if (result.type === 'magic') {
    return (
      <span className="shrink-0 whitespace-nowrap font-medium text-success">
        {'=> '}
        {result.value}
      </span>
    );
  }

  if (result.type === 'autoLog') {
    // RL-020 Slice 5 fold B — distinct icon + low-contrast italic so
    // bare-expression auto-log rows are visually distinct from
    // explicit `//=>` arrows (success-tone bold) and `@watch` pins
    // (pin icon + bold). The icon carries no a11y label of its own;
    // the surrounding span provides the announcement.
    return (
      <span
        data-result-kind="autoLog"
        aria-label={autoLogAriaLabel}
        title={autoLogTooltip}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap italic text-muted"
      >
        <MoveRight size={11} aria-hidden="true" className="opacity-70" />
        <span>{result.value}</span>
      </span>
    );
  }

  if (result.type === 'watch') {
    // RL-020 Slice 3 — pinned watch from `// @watch <expr>`. Fold B
    // renders a Pin icon; fold F wraps the value in an aria-live
    // region so screen readers announce updates; fold G replaces
    // `undefined` with an explicit "no value yet" string because a
    // pinned watch is meaningful even when its value is currently
    // undefined (different from arrow `//=>` which hideUndefined can
    // silently filter).
    const display = result.value === 'undefined' ? watchEmptyCopy : result.value;
    return (
      <span
        data-result-kind="watch"
        aria-label={watchAriaLabel}
        title={watchTooltip}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-success"
      >
        <Pin size={11} aria-hidden="true" className="opacity-80" />
        <span aria-live="polite">{display}</span>
      </span>
    );
  }

  const colorClass =
    result.type === 'error'
      ? 'text-error'
      : result.type === 'warn'
        ? 'text-warning'
        : result.type === 'info'
          ? 'text-info'
          : result.type === 'result'
            ? 'font-medium text-foreground'
          : 'text-muted';

  return <span className={`shrink-0 whitespace-nowrap ${colorClass}`}>{result.value}</span>;
}

interface LineAlignedResultsProps {
  lineResults: LineResult[];
  lineCount: number;
  fontSize: number;
  lineHeight: number;
  paddingTop: number;
  watchTooltip: string;
  watchAriaLabel: string;
  watchEmptyCopy: string;
  autoLogTooltip: string;
  autoLogAriaLabel: string;
}

function LineAlignedResults({
  lineResults,
  lineCount,
  fontSize,
  lineHeight,
  paddingTop,
  watchTooltip,
  watchAriaLabel,
  watchEmptyCopy,
  autoLogTooltip,
  autoLogAriaLabel,
}: LineAlignedResultsProps) {
  const resultsByLine = new Map<number, LineResult[]>();
  for (const result of lineResults) {
    const existing = resultsByLine.get(result.line) ?? [];
    existing.push(result);
    resultsByLine.set(result.line, existing);
  }

  return (
    <div className="font-mono" style={{ fontSize, paddingTop }}>
      {Array.from({ length: lineCount }, (_, index) => {
        const lineNumber = index + 1;
        const results = resultsByLine.get(lineNumber);

        return (
          <div
            key={lineNumber}
            style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}
            className="flex min-w-0 items-center gap-3 overflow-x-auto px-4"
          >
            {results?.map((result, resultIndex) => (
              <LineResultRow
                key={resultIndex}
                result={result}
                watchTooltip={watchTooltip}
                watchAriaLabel={watchAriaLabel}
                watchEmptyCopy={watchEmptyCopy}
                autoLogTooltip={autoLogTooltip}
                autoLogAriaLabel={autoLogAriaLabel}
              />
            )) ?? null}
          </div>
        );
      })}
    </div>
  );
}

function FullOutputView({
  output,
  error,
  emptyText,
}: {
  output: string;
  error: string | null;
  emptyText: string;
}) {
  return (
    <div className="p-4 font-mono text-xs leading-6">
      {output && <pre className="whitespace-pre-wrap text-foreground">{output}</pre>}
      {error && <pre className="mt-3 whitespace-pre-wrap text-error">{error}</pre>}
      {!output && !error && <span className="italic text-muted">{emptyText}</span>}
    </div>
  );
}

function isUndefinedResult(result: LineResult): boolean {
  // RL-020 Slice 3 fold G — watches stay visible even when their
  // current value is `undefined`. The user explicitly pinned the
  // expression; silently hiding it would erase intent. Watches with
  // `undefined` get a placeholder copy in `LineResultRow` instead.
  if (result.type === 'watch') return false;
  // RL-020 Slice 5 — auto-log rows DO respect the `hideUndefined`
  // filter. A whole-buffer auto-log pass on a 50-line program would
  // surface `undefined` for every `console.log(...)` statement; the
  // user expects the existing filter to apply rather than seeing a
  // wall of `undefined` annotations.
  if (result.type === 'autoLog' && result.value === 'undefined') return true;
  return result.type === 'result' && result.value === 'undefined';
}

export function ResultPanel() {
  const { t } = useTranslation();
  const { lineResults, fullOutput, error, executionTime, isAutoRunning } = useResultStore();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const hideUndefined = useSettingsStore((state) => state.hideUndefined);
  const toggleHideUndefined = useSettingsStore((state) => state.toggleHideUndefined);
  const settingsFontSize = useSettingsStore((state) => state.fontSize);

  const language = activeTab?.language ?? 'javascript';
  const dynamic = isInlineResultLanguage(language);
  const executionMode = executionModeForLanguage(language);
  const lineCount = (activeTab?.content ?? '').split('\n').length;
  const undefinedResultCount = lineResults.filter(isUndefinedResult).length;
  const visibleLineResults = hideUndefined
    ? lineResults.filter((result) => !isUndefinedResult(result))
    : lineResults;
  const showUndefinedToggle = dynamic && undefinedResultCount > 0;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScrollSync = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.scrollTop !== undefined) {
        element.scrollTop = detail.scrollTop;
      }
    };

    window.addEventListener('lingua:editor-scroll', handleScrollSync);
    return () => window.removeEventListener('lingua:editor-scroll', handleScrollSync);
  }, []);

  const hasContent = dynamic
    ? visibleLineResults.length > 0
    : fullOutput.length > 0 || error !== null;

  const fontSize = settingsFontSize;
  const lineHeight = Math.round(fontSize * 1.35);
  const paddingTop = 12;

  const titleKey = dynamic
    ? 'results.inline.title'
    : executionMode === 'validate'
      ? 'results.validation.title'
      : executionMode === 'view'
        ? 'results.view.title'
        : 'results.output.title';
  const descriptionKey = dynamic
    ? 'results.inline.description'
    : executionMode === 'validate'
      ? 'results.validation.description'
      : executionMode === 'view'
        ? 'results.view.description'
        : 'results.output.description';
  // RL-020 Slice 2 fold G — mode-aware empty-state copy. In Run /
  // Debug mode the user has to press Cmd+R, so a generic "Run to
  // see output" reads stale. Scratchpad-mode tabs keep the live-
  // updates copy; validate / view modes stay on their language-
  // specific keys.
  const workflowMode = activeTab
    ? activeTab.workflowMode ?? defaultWorkflowMode(activeTab.language)
    : 'scratchpad';
  const emptyKey = dynamic
    ? workflowMode === 'scratchpad'
      ? 'results.empty.inline'
      : 'results.empty.manualWorkflow'
    : executionMode === 'validate'
      ? 'results.empty.validation'
      : executionMode === 'view'
        ? 'results.empty.view'
        : 'results.empty.manual';

  return (
    <div className="flex h-full flex-col bg-background/65">
      <div className="surface-header flex h-12 shrink-0 items-center justify-between px-4">
        <div>
          <span className="panel-title">{t(titleKey)}</span>
          <p className="mt-0.5 text-[11px] text-muted">
            {t(descriptionKey)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAutoRunning && <Loader2 size={13} className="animate-spin text-primary" />}
          <AutoRunGateNotice />
          {/* RL-020 Slice 2 fold B — workflow-mode pill next to the
              execution-time slot. Surfaces "why didn't this run?"
              answers without forcing the user to look at the
              toolbar. Low-contrast so it never fights the
              AutoRunGateNotice. */}
          <WorkflowModeStatusPill />
          {/* RL-020 Slice 5 fold E — Auto-log status pill. Self-gates
              on JS / TS + Scratchpad workflow mode + resolved
              `autoLogEnabled` flag, so it stays silent everywhere
              else. Renders next to the workflow-mode pill so the
              two stay visually grouped. */}
          <AutoLogStatusPill />
          {/* RL-020 Slice 4 — per-tab Recent Runs pill. Self-gates
              on entitlement + executionMode + non-empty tab
              history; renders nothing for Free / view-only /
              validate-only tabs or tabs with zero entries. */}
          <RecentRunsPill />
          {executionTime !== null && (
            <span className="status-pill tabular-nums">{formatExecTime(executionTime)}</span>
          )}
          {showUndefinedToggle && (
            <button
              onClick={toggleHideUndefined}
              title={
                hideUndefined ? t('results.actions.showUndefined') : t('results.actions.hideUndefined')
              }
              className={`button-secondary px-2.5 py-1 font-mono text-[10px] ${
                hideUndefined ? 'border-primary/25 bg-primary-soft text-primary' : ''
              }`}
            >
              {t('results.actions.undefined')}
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {!hasContent && !isAutoRunning ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-xs italic text-muted">{t(emptyKey)}</span>
          </div>
        ) : dynamic ? (
          <>
            <LineAlignedResults
              lineResults={visibleLineResults}
              lineCount={lineCount}
              fontSize={fontSize}
              lineHeight={lineHeight}
              paddingTop={paddingTop}
              watchTooltip={t('magic.watch.tooltip')}
              watchAriaLabel={t('magic.watch.ariaLabel')}
              watchEmptyCopy={t('magic.watch.empty')}
              autoLogTooltip={t('autoLog.result.tooltip')}
              autoLogAriaLabel={t('autoLog.result.ariaLabel')}
            />
            {error && (
              <div className="border-t border-error/20 bg-error/10 px-4 py-3">
                <pre className="whitespace-pre-wrap font-mono text-xs text-error">
                  {error.message}
                  {error.line !== undefined && ` (line ${error.line})`}
                </pre>
              </div>
            )}
          </>
        ) : (
          <FullOutputView
            output={fullOutput}
            error={error?.message ?? null}
            emptyText={t(emptyKey)}
          />
        )}
      </div>
    </div>
  );
}

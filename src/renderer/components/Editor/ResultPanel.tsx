import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatExecTime } from '../../hooks/runnerOutput';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { isHiddenUndefinedLineResult } from '../../hooks/useInlineResults';
import { executionModeForLanguage } from '../../utils/languageMeta';
import { isInlineResultLanguage } from '../../utils/languageCapabilities';
import { AutoRunGateNotice } from './AutoRunGateNotice';
import { AutoLogStatusPill } from './AutoLogStatusPill';
import { StdinStatusPill } from './StdinStatusPill';
import { RecentRunsPill } from './RecentRunsPill';
import { RunCapsuleExportButton } from './RunCapsuleExportButton';
import { ShareLinkButton } from '../Share/ShareLinkButton';
import { RunStatusPill } from './RunStatusPill';
import { CompareResultsPanel } from './CompareResultsPanel';
import { resolveCompareTargetSnapshot } from '../../utils/snapshotDiff';
import { defaultWorkflowMode } from '../../../shared/workflowMode';

function FullOutputView({
  output,
  error,
  emptyText,
  fontSize,
}: {
  output: string;
  error: string | null;
  emptyText: string;
  fontSize: number;
}) {
  return (
    <div className="p-4 font-mono leading-6" style={{ fontSize }}>
      {output && <pre className="whitespace-pre-wrap text-foreground">{output}</pre>}
      {error && <pre className="mt-3 whitespace-pre-wrap text-error">{error}</pre>}
      {!output && !error && <span className="italic text-muted">{emptyText}</span>}
    </div>
  );
}

export function ResultPanel() {
  const { t } = useTranslation();
  const { lineResults, fullOutput, error, executionTime, isAutoRunning } = useResultStore();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  // Slice 2 — hide-undefined is baseline; the runtime button + Settings
  // toggle were removed. `undefined` rows never reach the inline panel.
  const settingsFontSize = useSettingsStore((state) => state.fontSize);

  const language = activeTab?.language ?? 'javascript';
  const dynamic = isInlineResultLanguage(language);
  const executionMode = executionModeForLanguage(language);
  // RL-020 Slice 8 — the Compare panel renders when the active
  // tab opted in AND the result store carries a comparator
  // snapshot for the same language. Falsy by default so nothing
  // changes for users who don't touch the toggle.
  const snapshotRing = useResultStore((state) => state.snapshotRing);
  const selectedCompareTargetCapturedAt = useResultStore(
    (state) => state.selectedCompareTargetCapturedAt
  );
  const compareTargetSnapshot = useMemo(
    () =>
      resolveCompareTargetSnapshot({
        snapshotRing,
        language,
        selectedCapturedAt: selectedCompareTargetCapturedAt,
        current: { lineResults, fullOutput },
      }),
    [
      snapshotRing,
      language,
      selectedCompareTargetCapturedAt,
      lineResults,
      fullOutput,
    ]
  );
  const compareEnabled =
    executionMode === 'run' &&
    activeTab?.compareWithSnapshotEnabled === true &&
    compareTargetSnapshot !== null;

  // RL-020 Slice 9 — variable inspector visibility gate. The toggle
  // is only meaningful when the active language is in the
  // inspector's supported set AND the result store carries a
  // language-matching snapshot. Mutually exclusive with Compare:
  // turning Variables on flips Compare off via the editor-store
  // setter (`setTabVariableInspectorEnabled`).
  // RL-020 Slice 8 fold G — inline diff badges. Only render in
  // RL-093 Slice 3 — `inlineDiffMarkers` previously fed
  // <LineAlignedResults> with per-line diff badges (+/−/~) when
  // Compare wasn't the active view. With the scratchpad inline
  // results now rendered in-editor via Monaco overlay widgets, the
  // result-panel body no longer needs the markers; Compare still
  // surfaces deltas via <CompareResultsPanel>. The diff computation
  // was removed alongside the body to keep the rendering path
  // honest.
  const visibleLineResults = lineResults.filter(
    (result) => !isHiddenUndefinedLineResult(result),
  );
  void visibleLineResults; // referenced for completeness; the body
                           // path that consumed it was removed.

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

  // `FullOutputView` reads the user's editor font size so the stdout
  // dump matches the editor's typography. Only consumed in non-
  // dynamic modes (run / debug / validate / view).
  const fontSize = settingsFontSize;

  // RL-093 Slice 3 — the "Resultado en línea / Sincronizado con las
  // líneas del editor" title was dropped from the scratchpad path
  // because (a) the workflow mode is now visible in the floating
  // action pill and (b) the per-line values render inside the editor
  // via Monaco overlay widgets, making a result-panel-side copy of
  // the same info redundant. validate / view modes (no inline
  // results) still need their distinctive header so users know what
  // kind of file they have open.
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
    <div className="flex h-full flex-col bg-[var(--color-editor-bg)]">
      {/* RL-093 Slice 3 — header layout differs by execution mode.
          For scratchpad / run / debug we drop the redundant "Resultado
          en línea" copy (workflow mode is on the pill; inline values
          render inside the editor via overlay widgets) and only keep
          the actionable status pills aligned to the right. For
          validate / view modes the header keeps the title +
          description because those tabs don't have inline results to
          consult. */}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle/60 px-4 py-2">
        {dynamic ? (
          <span aria-hidden />
        ) : (
          <div className="min-w-0">
            <span className="panel-title">{t(titleKey)}</span>
            <p className="mt-0.5 text-[11px] text-muted">{t(descriptionKey)}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
          {isAutoRunning && <Loader2 size={13} className="animate-spin text-primary" />}
          <AutoRunGateNotice />
          <AutoLogStatusPill />
          <StdinStatusPill />
          <RunStatusPill />
          <RecentRunsPill />
          {executionTime !== null && (
            <span className="status-pill tabular-nums whitespace-nowrap">
              {formatExecTime(executionTime)}
            </span>
          )}
          {/* RL-094 Slice 1.5 — primary export surface. Lazy-renders
              null when there's no captured capsule so it never
              advertises a no-op; safe to mount unconditionally. */}
          <RunCapsuleExportButton />
          {/* RL-036 Phase A1 fold E — primary share-link surface.
              Lazy-renders null when there's no active tab. */}
          <ShareLinkButton />
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {compareEnabled ? (
          // RL-020 Slice 8 — re-mount the compare body on tab switch
          // so the internal granularity state resets to `'line'` for
          // each tab. Without this `key`, a `'word'` granularity
          // picked on a compiled-language tab would persist across
          // a switch to a fresh tab. The reviewer flagged this as
          // critical because the leak surfaces invisibly (dynamic
          // mode hides the selector) until the user reaches another
          // compiled tab.
          <CompareResultsPanel
            key={activeTab?.id ?? 'none'}
            language={language}
          />
        ) : !hasContent && !isAutoRunning ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-xs italic text-muted">{t(emptyKey)}</span>
          </div>
        ) : dynamic ? (
          // RL-093 Slice 3 — in scratchpad mode the per-line values
          // render inside the editor via Monaco overlay widgets
          // (`useInlineResultWidgets`), so the result panel body no
          // longer mirrors them. The body keeps the error pane (when
          // the runner failed) and otherwise stays empty — Compare
          // and Variables still claim the area when active. The diff
          // badges from `inlineDiffMarkers` are surfaced inline by
          // the Compare view (gated above).
          <>
            {error ? (
              <div className="border-t border-error/20 bg-error/10 px-4 py-3">
                <pre className="whitespace-pre-wrap font-mono text-xs text-error">
                  {error.message}
                  {error.line !== undefined &&
                    ` ${t('results.inline.errorLineSuffix', { line: error.line })}`}
                </pre>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <span className="text-xs italic text-muted">
                  {t('results.inline.editorHint')}
                </span>
              </div>
            )}
          </>
        ) : (
          <FullOutputView
            output={fullOutput}
            error={error?.message ?? null}
            emptyText={t(emptyKey)}
            fontSize={fontSize}
          />
        )}
      </div>
    </div>
  );
}

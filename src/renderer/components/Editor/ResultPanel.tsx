import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { formatExecTime } from '../../hooks/runnerOutput';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore, type LineResult } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';

const DYNAMIC_LANGUAGES = new Set(['javascript', 'typescript', 'python']);

function isDynamic(language: string): boolean {
  return DYNAMIC_LANGUAGES.has(language);
}

function LineResultRow({ result }: { result: LineResult }) {
  if (result.type === 'magic') {
    return <span className="whitespace-nowrap font-medium text-success">{'=> '}{result.value}</span>;
  }

  const colorClass =
    result.type === 'error'
      ? 'text-error'
      : result.type === 'warn'
        ? 'text-warning'
        : result.type === 'info'
          ? 'text-info'
          : 'text-muted';

  return <span className={`whitespace-nowrap ${colorClass}`}>{result.value}</span>;
}

interface LineAlignedResultsProps {
  lineResults: LineResult[];
  lineCount: number;
  fontSize: number;
  lineHeight: number;
  paddingTop: number;
}

function LineAlignedResults({
  lineResults,
  lineCount,
  fontSize,
  lineHeight,
  paddingTop,
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
            className="flex items-center overflow-x-auto px-4"
          >
            {results?.map((result, resultIndex) => (
              <LineResultRow key={resultIndex} result={result} />
            )) ?? null}
          </div>
        );
      })}
    </div>
  );
}

function FullOutputView({ output, error }: { output: string; error: string | null }) {
  return (
    <div className="p-4 font-mono text-xs leading-6">
      {output && <pre className="whitespace-pre-wrap text-foreground">{output}</pre>}
      {error && <pre className="mt-3 whitespace-pre-wrap text-error">{error}</pre>}
      {!output && !error && <span className="italic text-muted">Run to see output...</span>}
    </div>
  );
}

export function ResultPanel() {
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
  const dynamic = isDynamic(language);
  const lineCount = (activeTab?.content ?? '').split('\n').length;
  const visibleLineResults = hideUndefined
    ? lineResults.filter((result) => result.value !== 'undefined')
    : lineResults;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScrollSync = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.scrollTop !== undefined) {
        element.scrollTop = detail.scrollTop;
      }
    };

    window.addEventListener('runlang:editor-scroll', handleScrollSync);
    return () => window.removeEventListener('runlang:editor-scroll', handleScrollSync);
  }, []);

  const hasContent = dynamic
    ? visibleLineResults.length > 0
    : fullOutput.length > 0 || error !== null;

  const fontSize = settingsFontSize;
  const lineHeight = Math.round(fontSize * 1.35);
  const paddingTop = 12;

  return (
    <div className="flex h-full flex-col bg-background/65">
      <div className="surface-header flex h-12 shrink-0 items-center justify-between px-4">
        <div>
          <span className="panel-title">{dynamic ? 'Inline Result' : 'Program Output'}</span>
          <p className="mt-0.5 text-[11px] text-muted">
            {dynamic ? 'Synced to editor lines' : 'Captured after execution'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAutoRunning && <Loader2 size={13} className="animate-spin text-primary" />}
          {executionTime !== null && (
            <span className="status-pill tabular-nums">{formatExecTime(executionTime)}</span>
          )}
          {dynamic && (
            <button
              onClick={toggleHideUndefined}
              title={hideUndefined ? 'Show undefined' : 'Hide undefined'}
              className={`button-secondary px-2.5 py-1 font-mono text-[10px] ${
                hideUndefined ? 'border-primary/25 bg-primary-soft text-primary' : ''
              }`}
            >
              undef
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {!hasContent && !isAutoRunning ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-xs italic text-muted">
              {dynamic
                ? 'Results appear here as you type.'
                : 'Output appears after the current program finishes.'}
            </span>
          </div>
        ) : dynamic ? (
          <>
            <LineAlignedResults
              lineResults={visibleLineResults}
              lineCount={lineCount}
              fontSize={fontSize}
              lineHeight={lineHeight}
              paddingTop={paddingTop}
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
          <FullOutputView output={fullOutput} error={error?.message ?? null} />
        )}
      </div>
    </div>
  );
}

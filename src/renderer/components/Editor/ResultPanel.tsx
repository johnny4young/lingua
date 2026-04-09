import { useEffect, useRef } from 'react';
import { useResultStore, type LineResult } from '../../stores/resultStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatExecTime } from '../../hooks/runnerOutput';
import { Loader2 } from 'lucide-react';

const DYNAMIC_LANGUAGES = new Set(['javascript', 'typescript', 'python']);

function isDynamic(language: string): boolean {
  return DYNAMIC_LANGUAGES.has(language);
}

// ---------------------------------------------------------------------------
// Per-line result view (dynamic languages)
// ---------------------------------------------------------------------------

function LineResultRow({ result }: { result: LineResult }) {
  if (result.type === 'magic') {
    return (
      <span className="whitespace-nowrap text-emerald-400 font-medium">
        {'=> '}{result.value}
      </span>
    );
  }

  const colorClass =
    result.type === 'error'
      ? 'text-red-400'
      : result.type === 'warn'
        ? 'text-yellow-400'
        : result.type === 'info'
          ? 'text-blue-400'
          : 'text-gray-400';

  return (
    <span className={`whitespace-nowrap ${colorClass}`}>{result.value}</span>
  );
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
  // Group results by line number
  const resultsByLine = new Map<number, LineResult[]>();
  for (const r of lineResults) {
    const existing = resultsByLine.get(r.line) ?? [];
    existing.push(r);
    resultsByLine.set(r.line, existing);
  }

  return (
    <div
      className="font-mono"
      style={{ fontSize, paddingTop }}
    >
      {Array.from({ length: lineCount }, (_, i) => {
        const lineNum = i + 1;
        const results = resultsByLine.get(lineNum);
        return (
          <div
            key={lineNum}
            style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}
            className="flex items-center overflow-x-auto px-3"
          >
            {results ? (
              results.map((r, j) => (
                <LineResultRow key={j} result={r} />
              ))
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full output view (compiled languages)
// ---------------------------------------------------------------------------

function FullOutputView({ output, error }: { output: string; error: string | null }) {
  return (
    <div className="p-3 font-mono text-xs leading-5">
      {output && (
        <pre className="whitespace-pre-wrap text-gray-300">{output}</pre>
      )}
      {error && (
        <pre className="mt-2 whitespace-pre-wrap text-red-400">{error}</pre>
      )}
      {!output && !error && (
        <span className="text-gray-600 italic">Run to see output...</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ResultPanel
// ---------------------------------------------------------------------------

export function ResultPanel() {
  const { lineResults, fullOutput, error, executionTime, isAutoRunning } =
    useResultStore();
  const activeTab = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const hideUndefined = useSettingsStore((s) => s.hideUndefined);
  const toggleHideUndefined = useSettingsStore((s) => s.toggleHideUndefined);

  const language = activeTab?.language ?? 'javascript';
  const dynamic = isDynamic(language);
  const lineCount = (activeTab?.content ?? '').split('\n').length;

  const visibleLineResults = hideUndefined
    ? lineResults.filter((r) => r.value !== 'undefined')
    : lineResults;

  // Sync scroll with Monaco editor
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Listen for Monaco scroll events via a custom event
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.scrollTop !== undefined) {
        el.scrollTop = detail.scrollTop;
      }
    };
    window.addEventListener('runlang:editor-scroll', handler);
    return () => window.removeEventListener('runlang:editor-scroll', handler);
  }, []);

  const settingsFontSize = useSettingsStore((s) => s.fontSize);

  const hasContent = dynamic
    ? visibleLineResults.length > 0
    : fullOutput.length > 0 || error !== null;

  // Match Monaco's line metrics: default lineHeight is ~1.35x fontSize, padding 12px
  const fontSize = settingsFontSize;
  const lineHeight = Math.round(fontSize * 1.35);
  const paddingTop = 12;

  return (
    <div className="flex h-full flex-col bg-gray-950 border-l border-gray-800/40">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-gray-800/60 px-3">
        <span className="text-xs font-medium text-gray-500">
          {dynamic ? 'Result' : 'Output'}
        </span>
        <div className="flex items-center gap-2">
          {isAutoRunning && (
            <Loader2 size={12} className="animate-spin text-primary-400" />
          )}
          {executionTime !== null && (
            <span className="text-[10px] tabular-nums text-gray-600">
              {formatExecTime(executionTime)}
            </span>
          )}
          {dynamic && (
            <button
              onClick={toggleHideUndefined}
              title={hideUndefined ? 'Show undefined' : 'Hide undefined'}
              className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
                hideUndefined
                  ? 'bg-gray-700 text-gray-300'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              undef
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        {!hasContent && !isAutoRunning ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-gray-700 italic">
              {dynamic
                ? 'Results appear here as you type...'
                : 'Output will appear after execution...'}
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
              <div className="border-t border-red-500/20 bg-red-500/5 px-3 py-2">
                <pre className="whitespace-pre-wrap font-mono text-xs text-red-400">
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
          />
        )}
      </div>
    </div>
  );
}

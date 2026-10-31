import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type * as monacoTypes from 'monaco-editor';
import { Play, RotateCcw, X } from 'lucide-react';
import '../../i18n/runRegionsCatalog';
import { useRunner } from '../../hooks/useRunner';
import { useResultStore, type LineResult } from '../../stores/resultStore';
import { useRunRegionStore } from '../../stores/runRegionStore';
import { parseRunRegions, resultComment, runRegionAt, type RunRegion, type RunRegionLanguage } from '../../utils/runRegions';
import { formatRunDuration } from '../../utils/timeLabels';
import { cn } from '../../utils/cn';
import { formatPayloadInlineSummary } from '../../../shared/richOutput';
import { inferKind } from '../Editor/inlineResultWidgetDom';
import { useLineWidget } from '../Editor/useLineWidget';
import { EyebrowMono } from '../ui/primitives';

const CARD_ID = 'lingua.runRegions.card';
const CARD_WIDTH = 560;
const MAX_ROWS = 6;

export interface RunRegionsProps {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
  tabId: string;
  language: RunRegionLanguage;
  content: string;
}

/** Last line of a region that holds code, so the card sits under it and not under blank lines. */
function lastCodeLine(content: string, region: RunRegion): number {
  const lines = content.split('\n');
  for (let line = region.endLine; line > region.startLine; line -= 1) {
    if ((lines[line - 1] ?? '').trim() !== '') return line;
  }
  return region.startLine;
}

function ResultRow({ row }: { row: LineResult }) {
  const rich = row.payload ? formatPayloadInlineSummary(row.payload) : null;
  const value = rich ? rich.display : row.value;
  const kind = row.type === 'error' ? 'error' : rich ? rich.kindLabel : inferKind(value);
  return (
    <div className="flex min-w-0 items-center gap-2 font-mono text-caption leading-[22px]">
      <span className="w-9 shrink-0 text-right text-fg-subtle">L{row.line}</span>
      <span className={cn('min-w-0 truncate', row.type === 'error' ? 'text-error-fg' : 'text-fg-base')} title={value}>
        {value}
      </span>
      <span className="shrink-0 text-micro uppercase tracking-wide text-fg-subtle">{kind}</span>
    </div>
  );
}

/** Region chips above the editor, the active region tinted, and the latest region's output under it. */
export function RunRegions({ editor, monaco, tabId, language, content }: RunRegionsProps) {
  const { t, i18n } = useTranslation();
  const { run, isRunning } = useRunner();
  const regions = useMemo(() => parseRunRegions(content, language), [content, language]);
  const [cursorLine, setCursorLine] = useState(() => editor?.getPosition()?.lineNumber ?? 1);
  const last = useRunRegionStore(state => (state.last?.tabId === tabId ? state.last : null));
  const lineResults = useResultStore(state => state.lineResults);
  const [node] = useState(() => document.createElement('div'));
  const [height, setHeight] = useState(72);
  const [width, setWidth] = useState(CARD_WIDTH);
  const runRegion = (region: RunRegion | null) => void run(region ? { region } : {});
  const runAtCursor = useEffectEvent(() => runRegion(runRegionAt(regions, cursorLine)));
  const runAll = useEffectEvent(() => runRegion(null));
  const hasRegions = regions.length > 0;

  const active = runRegionAt(regions, cursorLine);
  const shown = last ? regions.find(region => region.index === last.region.index && region.name === last.region.name) ?? null : null;
  const anchor = shown ? lastCodeLine(content, shown) : null;
  const rows = shown ? lineResults.filter(row => row.line >= shown.startLine && row.line <= shown.endLine) : [];
  const label = (region: RunRegion) => region.name ?? (region.markerLine === null ? t('runRegions.top') : t('runRegions.unnamed', { number: region.index + 1 }));

  useEffect(() => {
    if (!editor) return;
    const moves = editor.onDidChangeCursorPosition(event => setCursorLine(event.position.lineNumber));
    return () => moves.dispose();
  }, [editor]);

  // Inside the editor ⌘↵ runs the region at the cursor and ⌘⇧↵ the whole file; while a run is on, ⌘↵ stops it as before.
  useEffect(() => {
    if (!editor || !monaco || !hasRegions) return;
    const regionAction = editor.addAction({
      id: 'lingua.runRegions.run',
      label: t('runRegions.run'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      precondition: '!linguaManualRun',
      run: () => runAtCursor(),
    });
    const allAction = editor.addAction({
      id: 'lingua.runRegions.runAll',
      label: t('runRegions.runAll'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      precondition: '!linguaManualRun',
      run: () => runAll(),
    });
    return () => {
      regionAction.dispose();
      allAction.dispose();
    };
  }, [editor, monaco, hasRegions, t]);

  const activeStart = active?.startLine;
  const activeEnd = active?.endLine;
  useEffect(() => {
    if (!editor || !monaco || activeStart === undefined || activeEnd === undefined) return;
    const tint = editor.createDecorationsCollection([
      {
        range: new monaco.Range(activeStart, 1, activeEnd, 1),
        options: { isWholeLine: true, className: 'lingua-region-active' },
      },
    ]);
    return () => tint.clear();
  }, [editor, monaco, activeStart, activeEnd]);

  useEffect(() => {
    if (anchor === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor, node]);

  useEffect(() => {
    if (!editor || anchor === null) return;
    let zoneId = '';
    editor.changeViewZones(accessor => {
      zoneId = accessor.addZone({ afterLineNumber: anchor, heightInPx: height, domNode: document.createElement('div'), suppressMouseDown: true });
    });
    const fit = () => setWidth(Math.min(CARD_WIDTH, editor.getLayoutInfo().contentWidth - 32));
    fit();
    const layout = editor.onDidLayoutChange(fit);
    return () => {
      layout.dispose();
      editor.changeViewZones(accessor => accessor.removeZone(zoneId));
    };
  }, [editor, anchor, height]);

  useLineWidget(editor, monaco, anchor, node, { id: CARD_ID, placement: 'below' });

  // A new result scrolls its card into view; the line after the card stands in for its bottom edge.
  const ranAtKey = last?.ranAt;
  useEffect(() => {
    if (!editor || anchor === null || ranAtKey === undefined) return;
    const lineCount = editor.getModel()?.getLineCount() ?? anchor;
    editor.revealLineInCenterIfOutsideViewport(Math.min(anchor + 1, lineCount));
  }, [editor, anchor, ranAtKey]);

  if (!hasRegions) return null;

  const lastRow = [...rows].reverse().find(row => row.type === 'autoLog' || row.type === 'result');
  const model = editor?.getModel();
  const comment =
    lastRow && model && lastRow.line <= model.getLineCount() ? resultComment(language, model.getLineContent(lastRow.line), lastRow.value) : null;
  const insertComment = () => {
    if (!editor || !monaco || !lastRow || !comment || !model) return;
    const end = model.getLineMaxColumn(lastRow.line);
    editor.executeEdits('lingua.runRegions', [{ range: new monaco.Range(lastRow.line, end, lastRow.line, end), text: comment }]);
    editor.focus();
  };
  const select = (region: RunRegion) => {
    if (!editor) return;
    const line = Math.min(region.endLine, region.markerLine === null ? region.startLine : region.markerLine + 1);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.focus();
  };
  const ranAt = last ? new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(last.ranAt) : '';

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('runRegions.label')}
        data-testid="run-regions-bar"
        className="flex h-[34px] shrink-0 items-center gap-2 overflow-x-auto border-b border-border-subtle bg-bg-panel px-3"
      >
        <EyebrowMono>{t('runRegions.title')}</EyebrowMono>
        {regions.map(region => (
          <button
            key={region.index}
            type="button"
            aria-pressed={region === active}
            onClick={() => select(region)}
            data-testid="run-regions-chip"
            className={cn(
              'h-6 shrink-0 rounded-md border px-2 font-mono text-caption',
              region === active ? 'border-accent/60 bg-accent/15 text-fg-base' : 'border-border-subtle text-fg-muted hover:text-fg-base'
            )}
          >
            {label(region)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          disabled={isRunning || !active}
          aria-label={active ? t('runRegions.runLabel', { name: label(active) }) : t('runRegions.run')}
          title="⌘↵"
          onClick={() => runRegion(active)}
          data-testid="run-regions-run"
          className="button-secondary inline-flex h-[26px] shrink-0 items-center gap-1 px-[9px] text-caption"
        >
          <Play size={12} aria-hidden="true" />
          {t('runRegions.run')}
        </button>
        <button
          type="button"
          disabled={isRunning}
          title="⌘⇧↵"
          onClick={() => runRegion(null)}
          data-testid="run-regions-run-all"
          className="button-secondary inline-flex h-[26px] shrink-0 items-center px-[9px] text-caption"
        >
          {t('runRegions.runAll')}
        </button>
      </div>
      {shown && last && anchor !== null
        ? createPortal(
            <div
              role="group"
              aria-label={t('runRegions.card.label', { name: label(shown) })}
              data-testid="run-regions-card"
              style={{ width }}
              className={cn(
                'my-1.5 box-border rounded-lg border px-3 py-2 font-sans text-body text-fg-base',
                last.ok ? 'border-border-strong bg-bg-panel' : 'border-error/50 bg-error/10'
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-semibold">{label(shown)}</span>
                <span className="min-w-0 truncate font-mono text-caption text-fg-muted" data-testid="run-regions-ran">
                  {t('runRegions.card.ran', { time: ranAt, duration: formatRunDuration(last.executionTime) })}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={t('runRegions.card.close')}
                  title={t('runRegions.card.close')}
                  onClick={() => useRunRegionStore.getState().clearTab(tabId)}
                  data-testid="run-regions-close"
                  className="icon-button h-6 w-6 shrink-0 rounded-md"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
              {!last.ok && last.message && !rows.some(row => row.type === 'error') ? (
                <p className="mt-1 truncate font-mono text-caption text-error-fg">{last.message}</p>
              ) : null}
              {rows.length > 0 ? (
                <div className="mt-1" data-testid="run-regions-rows">
                  {rows.slice(-MAX_ROWS).map((row, index) => (
                    <ResultRow key={`${row.line}-${index}`} row={row} />
                  ))}
                </div>
              ) : last.ok ? (
                <p className="mt-1 text-caption text-fg-subtle">{t('runRegions.card.empty')}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {comment ? (
                  <button type="button" onClick={insertComment} data-testid="run-regions-insert" className="button-secondary h-6 shrink-0 px-2 text-caption">
                    {t('runRegions.card.insert')}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => runRegion(shown)}
                  data-testid="run-regions-rerun"
                  className="button-secondary inline-flex h-6 shrink-0 items-center gap-1 px-2 text-caption"
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  {t('runRegions.card.rerun')}
                </button>
              </div>
            </div>,
            node
          )
        : null}
    </>
  );
}

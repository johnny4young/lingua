import { DEBUGGER_HUD_HEIGHT, stepHudLine } from '../Debugger/debuggerHudGeometry';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import { useResultStore, type LineResult } from '../../stores/resultStore';
import { useEditorStore } from '../../stores/editorStore';
import { lineAnswerDelta, type AnswerDelta } from '../Answer/answerDelta';
import type { LineTimingEntry } from '../../types/execution';
import { AnswerColumnHeader } from './AnswerColumnHeader';
import { InlineAnswerLine } from './InlineAnswerLine';
import { answerColumnBand, belowAnswerWidth, jsStatementEndLine, lineEnd, lineIndent, statementEndLine, type JsLineDepth } from './answerColumnGeometry';
import { walkTopLevelLines } from '../../utils/magicComments/jsLexer';
import { createInlineResultNode } from './inlineResultWidgetDom';
import './inlineAnswers.css';

const INLINE_RESULT_WIDGET_PREFIX = 'lingua.inlineResult';
/** Space either side of the leader, and its shortest length before the answer moves below. */
const LEADER_MARGIN = 14;
const MIN_LEADER = 26;
const NO_TIMINGS: readonly LineTimingEntry[] = [];

let watchingTabs = false;

/** Answers go with their tab; watched from here so the startup bundle does not carry it. */
function dropAnswersWithTheirTab(): void {
  if (watchingTabs) return;
  watchingTabs = true;
  useEditorStore.subscribe(state => {
    const kept = useResultStore.getState().tabAnswers;
    const closed = Object.keys(kept).filter(tabId => !state.tabs.some(tab => tab.id === tabId));
    if (closed.length === 0) return;
    const next = { ...kept };
    for (const tabId of closed) delete next[tabId];
    useResultStore.setState({ tabAnswers: next });
  });
}

export interface InlineResultWidgetsProps {
  readonly editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof monacoTypes | null;
  readonly lineResults: readonly LineResult[];
  readonly tabId: string | null;
  readonly lineTimings?: readonly LineTimingEntry[];
  // True while a run is in flight; reserved rows wait for it to finish.
  readonly running?: boolean;
  // Room another widget takes right after a line's text (the failing-line actions); a result that no longer fits beside it moves to its own row.
  readonly lineEndReserve?: { readonly line: number; readonly width: number } | null;
  readonly language?: string;
  /** Where the column header renders, above the editor. */
  readonly headerSlot?: HTMLElement | null;
  /** While a run is in flight: the run whose answers stay on the lines it has not answered yet. */
  readonly keptRun?: number | null;
}

/**
 * Activation-scoped Monaco overlay runtime.
 *
 * The host imports this component only after execution produces a visible
 * result or statement timing. Owning the hook in a component preserves React's
 * hook ordering while keeping rich-output formatting out of workspace startup.
 */
export function InlineResultWidgets({
  editor,
  monaco,
  lineResults,
  tabId,
  lineTimings = NO_TIMINGS,
  running = false,
  lineEndReserve = null,
  language,
  headerSlot = null,
  keptRun = null,
}: InlineResultWidgetsProps) {
  const widgets = useInlineResultWidgets(editor, monaco, lineResults, tabId, lineTimings, running, lineEndReserve, keptRun);
  const answering = widgets.some(widget => widget.items.length > 0);
  // A run clears its answers before publishing new ones; the header holds through it.
  const [header, setHeader] = useState(false);
  const showHeader = answering || (running && header);
  if (showHeader !== header) setHeader(showHeader);
  useEffect(dropAnswersWithTheirTab, []);
  const answers = useResultStore(state => (tabId ? state.tabAnswers[tabId] : undefined));
  const showChanges = useResultStore(state => state.showRunChanges);
  // A region run or a restored snapshot is not the run the previous one is compared with.
  const onScreen = useMemo(() => answers !== undefined && sameAnswers(lineResults, answers.latest.results), [answers, lineResults]);
  const previous = showChanges && onScreen ? answers?.previous : undefined;
  // A run clears the answers before it publishes, so the switch holds through it.
  const since = onScreen || lineResults.length === 0 || keptRun !== null ? (answers?.previous?.number ?? null) : null;
  const changes = useMemo(() => {
    const byLine = new Map<number, { delta: AnswerDelta; since: number }>();
    if (!answers || !previous) return byLine;
    for (const widget of widgets) {
      if (widget.kept) continue;
      const delta = lineAnswerDelta(widget.line, widget.items, previous, answers.latest.sources[widget.line]);
      if (delta) byLine.set(widget.line, { delta, since: previous.number });
    }
    return byLine;
  }, [answers, previous, widgets]);
  // The run the kept answers come from is said once, where this run has not reached yet.
  const firstKept = widgets.reduce((first, widget) => (widget.kept && widget.line < first ? widget.line : first), Infinity);
  return (
    <>
      {header && editor && headerSlot ? createPortal(<AnswerColumnHeader editor={editor} tabId={tabId} since={since} />, headerSlot) : null}
      {widgets.map(widget =>
        createPortal(
          <InlineAnswerLine
            items={widget.items}
            timing={widget.timing}
            language={language}
            source={widget.source}
            change={changes.get(widget.line) ?? null}
            keptFrom={widget.line === firstKept ? (keptRun ?? undefined) : undefined}
          />,
          widget.domNode,
          widget.id
        )
      )}
    </>
  );
}

interface InlineZone {
  id: string;
  height: number;
  // Line Monaco anchors the zone after; kept in step with its line layout.
  line: number;
  delegate: monacoTypes.editor.IViewZone;
}

interface InlineWidget {
  id: string;
  domNode: HTMLElement;
  line: number;
  zone?: InlineZone;
  /** The answer sits on its own row under the line instead of after a leader. */
  below: boolean;
  /** Lines from `line` to the line its row follows: the statement's end, or the last free line. */
  zoneOffset: number;
  /** Where an answer under its line starts, from the last pass. */
  indent: number;
  /** Wider than its column, as of the last time its size or the column changed. */
  clipped: boolean;
  /** `clipped` was measured after the last size or column change; off-screen answers wait until shown. */
  clipChecked: boolean;
  items: readonly LineResult[];
  timing?: { durationMs: number; slowest: boolean };
  source?: string;
  /** The line as the run that answered it executed it; null when that code is unknown. */
  ranSource: string | null;
  /** The previous run's answer, waiting for this run to reach the line. */
  kept: boolean;
}

interface LineCache {
  /** Model, language and version the cached lines belong to. */
  key: string;
  ends: Map<number, number>;
  indents: Map<number, number>;
  js?: JsLineDepth[];
}

interface RetainedZone {
  line: number;
  zone: InlineZone;
}

/** A kept answer belongs to the code its run saw; once its line changes, it goes. */
function holdsItsSource(model: monacoTypes.editor.ITextModel | null, widget: InlineWidget): boolean {
  return model !== null && widget.line <= model.getLineCount() && model.getLineContent(widget.line) === widget.ranSource;
}

function isClipped(element: Element | null): boolean {
  return element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1;
}

function sameAnswers(a: readonly LineResult[], b: readonly LineResult[]): boolean {
  return a.length === b.length && a.every((item, index) => item.line === b[index]!.line && item.type === b[index]!.type && item.value === b[index]!.value);
}

function answerSignature(items: readonly LineResult[]): string {
  return items
    .map(item => `${item.type}\u0000${item.name ?? ''}\u0000${item.value}\u0000${item.previous ?? ''}\u0000${item.depth ?? ''}`)
    .join('\u0001');
}

function newlineCount(text: string): number {
  return text.split('\n').length - 1;
}

/** Where Monaco's line layout moves a zone anchored after `line` for one edit. */
function shiftZoneLine(line: number, change: monacoTypes.editor.IModelContentChange): number {
  const { startLineNumber: start, endLineNumber: end } = change.range;
  const deleting = end - start;
  const inserting = newlineCount(change.text);
  const editing = Math.min(deleting, inserting);
  const from = start + editing + 1;
  let next = line;
  if (deleting > editing) {
    if (next > end) next -= end - from + 1;
    else if (next >= from) next = from - 1;
  }
  if (inserting > editing && next >= from) next += inserting - editing;
  return next;
}

/** Line that holds the source of `line` after one edit, or null once it is deleted. */
function shiftSourceLine(line: number, change: monacoTypes.editor.IModelContentChange): number | null {
  const { startLineNumber: start, endLineNumber: end, startColumn } = change.range;
  if (line < start || (line === start && startColumn > 1)) return line;
  if (line > end) return line + newlineCount(change.text) - (end - start);
  if (line === start && start !== end) return null;
  if (line > start && line < end) return null;
  return start + newlineCount(change.text);
}

/**
 * Answers line up in a fixed column, joined to their line by a dotted leader.
 * A line whose text reaches the column, or wraps, gets a Monaco view zone and
 * its answer moves beneath it; an answer taller than its line spreads over the
 * free lines below and reserves a zone only for what still does not fit. Model
 * line numbers never shift.
 */
function useInlineResultWidgets(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null,
  lineResults: readonly LineResult[],
  tabId: string | null,
  // per-statement timings from the last instrumented run.
  // Rendered as a trailing chip on the line's widget (or a standalone
  // widget for lines with no value result). Empty = feature inactive.
  lineTimings: readonly LineTimingEntry[],
  running: boolean,
  lineEndReserve: { readonly line: number; readonly width: number } | null,
  keptRun: number | null
) {
  const widgetsRef = useRef<Map<number, InlineWidget>>(new Map());
  // The last results' widgets, mounted still, until the next results decide which stay as kept answers.
  const detachedRef = useRef<InlineWidget[]>([]);
  // Read by the widget effect, which must not rebuild every widget when the hold ends.
  const keptRunRef = useRef(keptRun);
  useLayoutEffect(() => {
    keptRunRef.current = keptRun;
  }, [keptRun]);
  const nextIdRef = useRef(0);
  const [mounted, setMounted] = useState<readonly InlineWidget[]>([]);
  const lineEndReserveRef = useRef(lineEndReserve);
  const repositioningRef = useRef(false);
  const scheduledFrameRef = useRef<number | null>(null);
  const measurementGenerationRef = useRef(0);
  // Rows whose result line was deleted or merged; removed on the next frame.
  const orphanZonesRef = useRef<InlineZone[]>([]);
  // Every run clears results before it publishes new ones. Keeping the old
  // rows reserved until the run finishes stops the source below from jumping.
  const retainedZonesRef = useRef<RetainedZone[]>([]);
  // Statement ends and indents per line for one model version and font.
  const lineCacheRef = useRef<LineCache>({ key: '', ends: new Map(), indents: new Map() });
  // Clipping only changes with an answer's size or the column; vertical scrolling skips the check.
  const clipDirtyRef = useRef(true);
  // What each line answered last time, so only a new or changed answer plays the answer motion.
  const answeredRef = useRef<Map<string, Map<number, string>>>(new Map());

  const cancelMeasurement = useCallback(() => {
    measurementGenerationRef.current += 1;
    if (scheduledFrameRef.current !== null) {
      cancelAnimationFrame(scheduledFrameRef.current);
      scheduledFrameRef.current = null;
    }
  }, []);

  const removeRetainedZones = useCallback(() => {
    const retained = retainedZonesRef.current;
    retainedZonesRef.current = [];
    if (!editor || retained.length === 0) return;
    repositioningRef.current = true;
    try {
      editor.changeViewZones(accessor => {
        for (const { zone } of retained) accessor.removeZone(zone.id);
      });
    } finally {
      repositioningRef.current = false;
    }
  }, [editor]);

  const removeOverlay = useCallback(
    (widget: InlineWidget) => {
      try {
        editor?.removeOverlayWidget({
          getId: () => widget.id,
          getDomNode: () => widget.domNode,
          getPosition: () => null,
        });
      } catch {
        /* widget already gone; ignore */
      }
    },
    [editor]
  );

  // Removes an overlay but keeps its row reserved for the next results.
  const releaseWidget = useCallback(
    (widget: InlineWidget) => {
      if (widget.zone) retainedZonesRef.current.push({ line: widget.line, zone: widget.zone });
      removeOverlay(widget);
    },
    [removeOverlay]
  );

  // The next results replace these widgets or keep them as the previous run's answers.
  const detachWidgets = useCallback(() => {
    cancelMeasurement();
    if (!editor) return;
    detachedRef.current.push(...widgetsRef.current.values());
    widgetsRef.current.clear();
  }, [editor, cancelMeasurement]);

  const releaseDetached = useCallback(() => {
    const detached = detachedRef.current;
    detachedRef.current = [];
    for (const widget of detached) releaseWidget(widget);
  }, [releaseWidget]);

  // Recompute every widget's `top` (and right gutter offset) when
  // anything that can shift line positions happens: scroll, layout,
  // model edits. Cheap O(widgets) — typically <50 lines per tab.
  const repositionAll = useCallback(() => {
    if (!editor || repositioningRef.current) return;
    repositioningRef.current = true;
    try {
      const model = editor.getModel();
      if (!model) return;
      const layout = editor.getLayoutInfo();
      const band = answerColumnBand(layout);
      const columnLeft = layout.contentLeft + band.start;
      const scrollLeft = editor.getScrollLeft();
      const cacheKey = `${model.id}\u0000${model.getLanguageId()}\u0000${model.getVersionId()}`;
      if (lineCacheRef.current.key !== cacheKey) lineCacheRef.current = { key: cacheKey, ends: new Map(), indents: new Map() };
      const cache = lineCacheRef.current;
      // The statement starting on a line, cut short when another answer sits inside it.
      const spanEnd = (line: number) => {
        let end = cache.ends.get(line);
        if (end === undefined) {
          const language = model.getLanguageId();
          if (language === 'javascript' || language === 'typescript') {
            if (!cache.js) {
              const depths: JsLineDepth[] = [];
              walkTopLevelLines(model.getValue(), info => depths.push(info));
              cache.js = depths;
            }
            end = jsStatementEndLine(cache.js, line);
          } else {
            end = statementEndLine(at => model.getLineContent(at), line, model.getLineCount(), language);
          }
          cache.ends.set(line, end);
        }
        for (let inner = line + 1; inner <= end; inner += 1) if (widgetsRef.current.has(inner)) return line;
        return end;
      };
      const indentOf = (widget: InlineWidget) => {
        let indent = cache.indents.get(widget.line);
        if (indent !== undefined) return indent;
        const measuredIndent = lineIndent(editor, widget.line);
        // An unrendered line keeps the last indent and is measured again next pass.
        if (measuredIndent === null) return widget.indent;
        cache.indents.set(widget.line, measuredIndent);
        return measuredIndent;
      };
      // Scrolled sideways, an answer under its line stays at the editor's left edge instead of leaving with its code.
      const placeUnder = (widget: InlineWidget) => {
        const shown = Math.max(0, widget.indent - scrollLeft);
        widget.domNode.style.left = `${layout.contentLeft + shown}px`;
        widget.domNode.style.setProperty('--answer-column-width', `${belowAnswerWidth(layout, shown)}px`);
      };
      if (clipDirtyRef.current) {
        for (const widget of widgetsRef.current.values()) widget.clipChecked = false;
        clipDirtyRef.current = false;
      }
      const visibleRanges = editor.getVisibleRanges();
      const isVisible = (line: number) =>
        visibleRanges.some(range => line >= range.startLineNumber && line <= range.endLineNumber);
      // Room left for a leader between a line's text and the column, in pixels.
      const leaderRoom = (line: number) => {
        const end = lineEnd(editor, line);
        if (end === null) return null;
        const reserved = lineEndReserveRef.current?.line === line ? lineEndReserveRef.current.width : 0;
        return band.start - end + scrollLeft - reserved - LEADER_MARGIN * 2;
      };
      const orphans = orphanZonesRef.current;
      orphanZonesRef.current = [];
      if (orphans.length > 0) {
        editor.changeViewZones(accessor => {
          for (const zone of orphans) accessor.removeZone(zone.id);
        });
      }
      const changes: Array<{ widget: InlineWidget; height: number; anchor: number }> = [];
      const measured: Array<{ widget: InlineWidget; lineHeight: number; height: number; room: number | null; wrapped: boolean; free: number; spanBlocked: boolean; indent: number }> = [];
      // Write first, then read everything, then write again: one layout per pass.
      for (const widget of widgetsRef.current.values()) {
        const visible = widget.line >= 1 && widget.line <= model.getLineCount() && isVisible(widget.line);
        widget.domNode.style.visibility = visible ? '' : 'hidden';
        widget.domNode.toggleAttribute('data-narrow', band.narrow);
        if (band.narrow) placeUnder(widget);
        else {
          widget.domNode.style.left = `${columnLeft}px`;
          widget.domNode.style.setProperty('--answer-column-width', `${band.width}px`);
        }
        if (visible) {
          const lineHeight = editor.getLineHeightForPosition({ lineNumber: widget.line, column: 1 });
          widget.domNode.style.setProperty('--inline-line-height', `${lineHeight}px`);
        }
      }
      for (const widget of widgetsRef.current.values()) {
        const valid = widget.line >= 1 && widget.line <= model.getLineCount();
        // Monaco cannot measure columns on an unrendered line. Preserve its
        // reserved row while scrolling, avoiding document-height oscillation;
        // an edit above it can still move the zone, so the row follows its source.
        if (valid && widget.domNode.style.visibility === 'hidden') {
          const anchor = widget.line + widget.zoneOffset;
          if (widget.zone && widget.zone.line !== anchor) changes.push({ widget, height: widget.zone.height, anchor });
          continue;
        }
        if (!valid) {
          if (widget.zone) changes.push({ widget, height: 0, anchor: widget.line });
          continue;
        }
        const lineHeight = editor.getLineHeightForPosition({ lineNumber: widget.line, column: 1 });
        const height = widget.domNode.getBoundingClientRect().height;
        const wrapped = editor.getBottomForLineNumber(widget.line) - editor.getTopForLineNumber(widget.line) > lineHeight + 1;
        const room = band.narrow ? null : leaderRoom(widget.line);
        let spanBlocked = false;
        let free = 0;
        if (room !== null && room >= MIN_LEADER && height > lineHeight * 1.5) {
          // A tall answer spreads over the free lines below before it takes a row.
          // Two pixels may overhang into the next line's leading.
          const needed = Math.ceil((height - 2) / lineHeight) - 1;
          for (let next = widget.line + 1; free < needed && next <= model.getLineCount(); next += 1) {
            if (widgetsRef.current.has(next)) break;
            // An unrendered line cannot be measured; counting it free keeps the row steady while scrolling.
            if (!isVisible(next)) {
              free += 1;
              continue;
            }
            const nextRoom = leaderRoom(next);
            if (nextRoom === null || nextRoom < 0) break;
            free += 1;
          }
          // A tall answer that cannot stand beside its whole statement moves under it rather than splitting it.
          spanBlocked = free < Math.min(needed, spanEnd(widget.line) - widget.line);
        }
        if (!widget.clipChecked) {
          widget.clipChecked = true;
          const body = widget.domNode.querySelector('.lingua-inline-result-body');
          // A table keeps its frame and cuts columns inside it, so it is checked on its own.
          widget.clipped = isClipped(body) || isClipped(body?.querySelector('.answer-object-table table') ?? null);
        }
        const indent = band.narrow ? indentOf(widget) : widget.indent;
        measured.push({ widget, lineHeight, height, room, wrapped, free, spanBlocked, indent });
      }
      for (const { widget, lineHeight, height: answerHeight, room, wrapped, free, spanBlocked, indent } of measured) {
        widget.below = room === null || wrapped || room < MIN_LEADER || spanBlocked;
        widget.domNode.toggleAttribute('data-below', widget.below);
        widget.domNode.toggleAttribute('data-clipped', widget.clipped);
        if (indent !== widget.indent) {
          widget.indent = indent;
          placeUnder(widget);
        }
        let height = 0;
        // A tall answer goes under its statement, or after the last free line it spreads over, so a statement never splits.
        let anchor = widget.line;
        if (widget.below) {
          height = Math.ceil(Math.max(lineHeight, answerHeight + 6));
          // Only a tall answer waits for the statement's end; a short one, such as an error, stays under its line.
          if (answerHeight > lineHeight * 1.5) anchor = spanEnd(widget.line);
        } else {
          widget.domNode.style.setProperty('--answer-leader', `${room}px`);
          const short = answerHeight - lineHeight * (1 + free);
          if (answerHeight > lineHeight * 1.5 && short > 2) {
            height = Math.ceil(short);
            anchor = widget.line + free;
          }
        }
        widget.zoneOffset = anchor - widget.line;
        const zoneHeight = widget.zone?.height ?? 0;
        const misplaced = widget.zone !== undefined && widget.zone.line !== anchor;
        if (zoneHeight !== height || (misplaced && height > 0)) {
          changes.push({ widget, height, anchor });
        }
      }
      if (changes.length > 0) {
        editor.changeViewZones(accessor => {
          for (const { widget, height, anchor } of changes) {
            if (widget.zone) accessor.removeZone(widget.zone.id);
            widget.zone = undefined;
            if (height > 0) {
              const spacer = document.createElement('div');
              spacer.setAttribute('aria-hidden', 'true');
              const delegate = {
                afterLineNumber: anchor,
                heightInPx: height,
                domNode: spacer,
                suppressMouseDown: true,
              };
              const id = accessor.addZone(delegate);
              widget.zone = { id, height, line: anchor, delegate };
            }
          }
        });
      }
      // Adding a zone moves subsequent lines; read positions after the batch.
      const scrollTop = editor.getScrollTop();
      // The step HUD's row comes first under the line it holds.
      const hudLine = stepHudLine(editor);
      for (const widget of widgetsRef.current.values()) {
        if (widget.domNode.style.visibility === 'hidden') continue;
        const top =
          widget.zone && widget.below
            ? editor.getBottomForLineNumber(widget.zone.line) + (widget.zone.line === hudLine ? DEBUGGER_HUD_HEIGHT : 0)
            : editor.getTopForLineNumber(widget.line);
        widget.domNode.style.top = `${top - scrollTop}px`;
      }
    } finally {
      repositioningRef.current = false;
    }
  }, [editor]);

  // getOffsetForColumn forces a Monaco render. Measuring synchronously from a
  // model/layout event can render before Monaco has updated its selections.
  // Coalesce every entry point after that event transaction, and never let an
  // old editor/widget generation measure or mutate its replacement.
  const scheduleReposition = useCallback(() => {
    if (
      !editor ||
      repositioningRef.current ||
      scheduledFrameRef.current !== null ||
      (widgetsRef.current.size === 0 && orphanZonesRef.current.length === 0)
    ) {
      return;
    }
    const generation = measurementGenerationRef.current;
    scheduledFrameRef.current = requestAnimationFrame(() => {
      if (generation !== measurementGenerationRef.current) return;
      scheduledFrameRef.current = null;
      repositionAll();
    });
  }, [editor, repositionAll]);

  useEffect(() => {
    lineEndReserveRef.current = lineEndReserve;
    scheduleReposition();
  }, [lineEndReserve?.line, lineEndReserve?.width, scheduleReposition]);


  // Wire scroll + layout listeners. Disposed on unmount / tab swap.
  useEffect(() => {
    if (!editor) return;
    let active = true;
    const schedule = () => {
      if (active) scheduleReposition();
    };
    const disposables: monacoTypes.IDisposable[] = [];
    disposables.push(editor.onDidScrollChange(schedule));
    disposables.push(
      editor.onDidLayoutChange(() => {
        clipDirtyRef.current = true;
        schedule();
      })
    );
    disposables.push(
      editor.onDidChangeConfiguration(() => {
        // A font change moves every indent.
        lineCacheRef.current = { key: '', ends: new Map(), indents: new Map() };
        clipDirtyRef.current = true;
        schedule();
      })
    );
    // Editor-level events follow `setModel` (a same-tab rename or save-as
    // swaps the model), unlike a listener bound to the model seen at mount.
    disposables.push(
      editor.onDidChangeModelContent(event => {
        // Results and rows follow their source until the next run replaces
        // them. Ranges use pre-edit lines, so apply them bottom-up.
        const bottomUp = [...event.changes].sort(
          (a, b) => b.range.startLineNumber - a.range.startLineNumber
        );
        const followSource = (line: number | null) => {
          for (const change of bottomUp) if (line !== null) line = shiftSourceLine(line, change);
          return line;
        };
        const followZone = (zone: InlineZone) => {
          for (const change of bottomUp) zone.line = shiftZoneLine(zone.line, change);
          zone.delegate.afterLineNumber = zone.line;
        };
        const moved = new Map<number, InlineWidget>();
        const byLine = [...widgetsRef.current.values()].sort((a, b) => a.line - b.line);
        const model = editor.getModel();
        for (const widget of byLine) {
          if (widget.zone) followZone(widget.zone);
          const line = followSource(widget.line);
          if (line !== null) widget.line = line;
          if (line === null || moved.has(line) || (widget.kept && !holdsItsSource(model, widget))) {
            if (widget.zone) orphanZonesRef.current.push(widget.zone);
            removeOverlay(widget);
            continue;
          }
          // The zone followed its own line; an edit inside the statement must not pull it back.
          if (widget.zone) widget.zoneOffset = Math.max(0, widget.zone.line - line);
          widget.domNode.setAttribute('data-line', String(line));
          moved.set(line, widget);
        }
        if (moved.size !== widgetsRef.current.size) setMounted([...moved.values()]);
        widgetsRef.current = moved;
        const retained: RetainedZone[] = [];
        for (const item of retainedZonesRef.current) {
          followZone(item.zone);
          const line = followSource(item.line);
          if (line === null) orphanZonesRef.current.push(item.zone);
          else retained.push({ line, zone: item.zone });
        }
        retainedZonesRef.current = retained;
        schedule();
      })
    );
    disposables.push(
      editor.onDidChangeModel(() => {
        // A model swap rebuilds Monaco's view and drops every view zone.
        for (const widget of widgetsRef.current.values()) widget.zone = undefined;
        retainedZonesRef.current = [];
        orphanZonesRef.current = [];
        schedule();
      })
    );
    return () => {
      active = false;
      cancelMeasurement();
      for (const d of disposables) d.dispose();
    };
  }, [editor, scheduleReposition, cancelMeasurement, removeOverlay]);

  // Apply / re-apply widgets whenever the line results change.
  useEffect(() => {
    if (!editor || !monaco) return;
    const grouped = new Map<number, LineResult[]>();
    for (const result of lineResults) {
      const list = grouped.get(result.line) ?? [];
      list.push(result);
      grouped.set(result.line, list);
    }
    // Index the timings and find the run's hot spot. Lines
    // that only have a timing still get a widget (empty items array).
    const timingByLine = new Map<number, number>();
    let slowestLine = 0;
    let slowestMs = -1;
    for (const entry of lineTimings) {
      timingByLine.set(entry.line, entry.durationMs);
      if (entry.durationMs > slowestMs) {
        slowestMs = entry.durationMs;
        slowestLine = entry.line;
      }
      if (!grouped.has(entry.line)) grouped.set(entry.line, []);
    }
    const model = editor.getModel();
    // While a run is in flight, the last results stay on the lines it has not answered and whose code is unchanged.
    const holding = keptRunRef.current !== null;
    // Only the run start's empty publish keeps fresh widgets; later publishes are this run's own answers.
    const starting = grouped.size === 0;
    const detached = detachedRef.current;
    detachedRef.current = [];
    for (const widget of detached) {
      if (
        !holding ||
        !(widget.kept || starting) ||
        grouped.has(widget.line) ||
        widgetsRef.current.has(widget.line) ||
        !holdsItsSource(model, widget)
      ) {
        releaseWidget(widget);
        continue;
      }
      widget.domNode.removeAttribute('data-enter');
      widget.domNode.setAttribute('data-kept', '');
      widgetsRef.current.set(widget.line, { ...widget, kept: true });
    }
    const ranCode = useResultStore.getState().ranCode;
    const ranLines = ranCode && ranCode.tabId === tabId ? ranCode.code.split('\n') : null;
    const answeredKey = tabId ?? '';
    const previousAnswers = answeredRef.current.get(answeredKey);
    const answered = new Map<number, string>();
    for (const [line, items] of grouped) {
      const timingMs = timingByLine.get(line);
      const domNode = createInlineResultNode(line);
      const signature = answerSignature(items);
      answered.set(line, signature);
      domNode.toggleAttribute('data-enter', items.length > 0 && previousAnswers?.get(line) !== signature);
      // Overlay widgets are absolutely-positioned children of the
      // editor's overlay layer. We control position via inline style;
      // Monaco only places the host element on the page.
      domNode.style.position = 'absolute';
      domNode.style.pointerEvents = 'none';
      domNode.style.visibility = 'hidden';
      // A kept answer may have moved onto another line, so ids never reuse a line number.
      const id = `${INLINE_RESULT_WIDGET_PREFIX}.${tabId ?? 'none'}.${line}.${(nextIdRef.current += 1)}`;
      const widget: InlineWidget = {
        id,
        domNode,
        line,
        below: false,
        zoneOffset: 0,
        indent: 0,
        clipped: false,
        clipChecked: false,
        items,
        timing: timingMs === undefined ? undefined : { durationMs: timingMs, slowest: line === slowestLine },
        source: model && line <= model.getLineCount() ? model.getLineContent(line) : undefined,
        ranSource: ranLines?.[line - 1] ?? null,
        kept: false,
      };
      const retainedIndex = retainedZonesRef.current.findIndex(item => item.line === line);
      if (retainedIndex >= 0) {
        widget.zone = retainedZonesRef.current[retainedIndex]!.zone;
        widget.zoneOffset = Math.max(0, widget.zone.line - line);
        retainedZonesRef.current.splice(retainedIndex, 1);
      }
      widgetsRef.current.set(line, widget);
      editor.addOverlayWidget({
        getId: () => id,
        getDomNode: () => domNode,
        // Returning `null` means "I'll place it myself via CSS top/right".
        getPosition: () => null,
      });
    }
    // An empty publish is a run clearing its results, not an answer going away.
    if (grouped.size > 0) answeredRef.current.set(answeredKey, answered);
    setMounted([...widgetsRef.current.values()]);
    let active = true;
    clipDirtyRef.current = true;
    scheduleReposition();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            clipDirtyRef.current = true;
            if (active) scheduleReposition();
          });
    for (const widget of widgetsRef.current.values()) observer?.observe(widget.domNode);
    return () => {
      active = false;
      observer?.disconnect();
      detachWidgets();
    };
  }, [
    editor,
    monaco,
    lineResults,
    lineTimings,
    tabId,
    detachWidgets,
    releaseWidget,
    scheduleReposition,
  ]);

  // The run settled or stopped holding: the answers it never reached go.
  useEffect(() => {
    if (keptRun !== null) return;
    let dropped = false;
    for (const [line, widget] of widgetsRef.current) {
      if (!widget.kept) continue;
      releaseWidget(widget);
      widgetsRef.current.delete(line);
      dropped = true;
    }
    if (dropped) setMounted([...widgetsRef.current.values()]);
  }, [keptRun, releaseWidget]);

  // Runs after the widget effect has adopted the rows its results still need.
  useEffect(() => {
    if (!running) removeRetainedZones();
  }, [running, keptRun, lineResults, lineTimings, removeRetainedZones]);

  // Declared after the widget effect so its cleanup runs last and also
  // removes the overlays and rows that cleanup just detached.
  useEffect(
    () => () => {
      releaseDetached();
      removeRetainedZones();
    },
    [releaseDetached, removeRetainedZones]
  );

  return mounted;
}

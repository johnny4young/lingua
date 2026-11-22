import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monacoTypes from 'monaco-editor';
import type { LineResult } from '../../stores/resultStore';
import type { LineTimingEntry } from '../../types/execution';
import { InlineAnswerLine } from './InlineAnswerLine';
import { answerColumnBand, lineEnd } from './answerColumnGeometry';
import { createInlineResultNode } from './inlineResultWidgetDom';

const INLINE_RESULT_WIDGET_PREFIX = 'lingua.inlineResult';
/** Space either side of the leader, and its shortest length before the answer moves below. */
const LEADER_MARGIN = 14;
const MIN_LEADER = 26;
const NO_TIMINGS: readonly LineTimingEntry[] = [];

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
}: InlineResultWidgetsProps) {
  const widgets = useInlineResultWidgets(editor, monaco, lineResults, tabId, lineTimings, running, lineEndReserve);
  return (
    <>
      {widgets.map(widget =>
        createPortal(
          <InlineAnswerLine items={widget.items} timing={widget.timing} language={language} source={widget.source} />,
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
  items: readonly LineResult[];
  timing?: { durationMs: number; slowest: boolean };
  source?: string;
}

interface RetainedZone {
  line: number;
  zone: InlineZone;
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
  lineEndReserve: { readonly line: number; readonly width: number } | null
) {
  const widgetsRef = useRef<Map<number, InlineWidget>>(new Map());
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

  // Removes the overlays but keeps their rows reserved for the next results.
  const detachWidgets = useCallback(() => {
    cancelMeasurement();
    if (!editor) return;
    for (const w of widgetsRef.current.values()) {
      if (w.zone) retainedZonesRef.current.push({ line: w.line, zone: w.zone });
      removeOverlay(w);
    }
    widgetsRef.current.clear();
  }, [editor, cancelMeasurement, removeOverlay]);

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
      const visibleRanges = editor.getVisibleRanges();
      const isVisible = (line: number) =>
        visibleRanges.some(range => line >= range.startLineNumber && line <= range.endLineNumber);
      // Room left for a leader between a line's text and the column, in pixels.
      const leaderRoom = (line: number) => {
        const end = lineEnd(editor, line);
        if (end === null) return null;
        const reserved = lineEndReserveRef.current?.line === line ? lineEndReserveRef.current.width : 0;
        return band.start - end + editor.getScrollLeft() - reserved - LEADER_MARGIN * 2;
      };
      const orphans = orphanZonesRef.current;
      orphanZonesRef.current = [];
      if (orphans.length > 0) {
        editor.changeViewZones(accessor => {
          for (const zone of orphans) accessor.removeZone(zone.id);
        });
      }
      const changes: Array<{ widget: InlineWidget; height: number }> = [];
      const measured: Array<{ widget: InlineWidget; lineHeight: number; height: number; room: number | null; wrapped: boolean; free: number }> = [];
      // Write first, then read everything, then write again: one layout per pass.
      for (const widget of widgetsRef.current.values()) {
        const visible = widget.line >= 1 && widget.line <= model.getLineCount() && isVisible(widget.line);
        widget.domNode.style.visibility = visible ? '' : 'hidden';
        widget.domNode.style.left = `${columnLeft}px`;
        widget.domNode.style.setProperty('--answer-column-width', `${band.width}px`);
        if (visible) {
          const lineHeight = editor.getLineHeightForPosition({ lineNumber: widget.line, column: 1 });
          widget.domNode.style.setProperty('--inline-line-height', `${lineHeight}px`);
        }
      }
      for (const widget of widgetsRef.current.values()) {
        // An edit at the start of a result line moves its source but not
        // Monaco's zone, so the row has to follow the source.
        const misplaced = widget.zone !== undefined && widget.zone.line !== widget.line;
        const valid = widget.line >= 1 && widget.line <= model.getLineCount();
        // Monaco cannot measure columns on an unrendered line. Preserve its
        // reserved row while scrolling, avoiding document-height oscillation.
        if (valid && widget.domNode.style.visibility === 'hidden') {
          if (misplaced) changes.push({ widget, height: widget.zone!.height });
          continue;
        }
        if (!valid) {
          if (widget.zone) changes.push({ widget, height: 0 });
          continue;
        }
        const lineHeight = editor.getLineHeightForPosition({ lineNumber: widget.line, column: 1 });
        const height = widget.domNode.getBoundingClientRect().height;
        const wrapped = editor.getBottomForLineNumber(widget.line) - editor.getTopForLineNumber(widget.line) > lineHeight + 1;
        const room = leaderRoom(widget.line);
        let free = 0;
        if (room !== null && room >= MIN_LEADER && height > lineHeight * 1.5) {
          // A tall answer spreads over the free lines below before it takes a row.
          // Two pixels may overhang into the next line's leading.
          const needed = Math.ceil((height - 2) / lineHeight) - 1;
          for (let next = widget.line + 1; free < needed && next <= model.getLineCount(); next += 1) {
            if (widgetsRef.current.has(next) || !isVisible(next)) break;
            const nextRoom = leaderRoom(next);
            if (nextRoom === null || nextRoom < 0) break;
            free += 1;
          }
        }
        measured.push({ widget, lineHeight, height, room, wrapped, free });
      }
      for (const { widget, lineHeight, height: answerHeight, room, wrapped, free } of measured) {
        widget.below = room === null || wrapped || room < MIN_LEADER;
        widget.domNode.toggleAttribute('data-below', widget.below);
        let height = 0;
        if (widget.below) {
          height = Math.ceil(Math.max(lineHeight, answerHeight + 6));
        } else {
          widget.domNode.style.setProperty('--answer-leader', `${room}px`);
          const short = answerHeight - lineHeight * (1 + free);
          if (answerHeight > lineHeight * 1.5 && short > 2) height = Math.ceil(short);
        }
        const zoneHeight = widget.zone?.height ?? 0;
        const misplaced = widget.zone !== undefined && widget.zone.line !== widget.line;
        if (zoneHeight !== height || (misplaced && zoneHeight > 0)) {
          changes.push({ widget, height });
        }
      }
      if (changes.length > 0) {
        editor.changeViewZones(accessor => {
          for (const { widget, height } of changes) {
            if (widget.zone) accessor.removeZone(widget.zone.id);
            widget.zone = undefined;
            if (height > 0) {
              const spacer = document.createElement('div');
              spacer.setAttribute('aria-hidden', 'true');
              const delegate = {
                afterLineNumber: widget.line,
                heightInPx: height,
                domNode: spacer,
                suppressMouseDown: true,
              };
              const id = accessor.addZone(delegate);
              widget.zone = { id, height, line: widget.line, delegate };
            }
          }
        });
      }
      // Adding a zone moves subsequent lines; read positions after the batch.
      const scrollTop = editor.getScrollTop();
      for (const widget of widgetsRef.current.values()) {
        if (widget.domNode.style.visibility === 'hidden') continue;
        const top =
          widget.zone && widget.below
            ? editor.getBottomForLineNumber(widget.line)
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
    disposables.push(editor.onDidLayoutChange(schedule));
    disposables.push(editor.onDidChangeConfiguration(schedule));
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
        for (const widget of byLine) {
          if (widget.zone) followZone(widget.zone);
          const line = followSource(widget.line);
          if (line === null || moved.has(line)) {
            if (widget.zone) orphanZonesRef.current.push(widget.zone);
            removeOverlay(widget);
            continue;
          }
          widget.line = line;
          widget.domNode.setAttribute('data-line', String(line));
          moved.set(line, widget);
        }
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
    for (const [line, items] of grouped) {
      const timingMs = timingByLine.get(line);
      const domNode = createInlineResultNode(line);
      // Overlay widgets are absolutely-positioned children of the
      // editor's overlay layer. We control position via inline style;
      // Monaco only places the host element on the page.
      domNode.style.position = 'absolute';
      domNode.style.pointerEvents = 'none';
      domNode.style.visibility = 'hidden';
      const id = `${INLINE_RESULT_WIDGET_PREFIX}.${tabId ?? 'none'}.${line}`;
      const widget: InlineWidget = {
        id,
        domNode,
        line,
        below: false,
        items,
        timing: timingMs === undefined ? undefined : { durationMs: timingMs, slowest: line === slowestLine },
        source: model && line <= model.getLineCount() ? model.getLineContent(line) : undefined,
      };
      const retainedIndex = retainedZonesRef.current.findIndex(item => item.line === line);
      if (retainedIndex >= 0) {
        widget.zone = retainedZonesRef.current[retainedIndex]!.zone;
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
    setMounted([...widgetsRef.current.values()]);
    let active = true;
    scheduleReposition();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
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
    scheduleReposition,
  ]);

  // Runs after the widget effect has adopted the rows its results still need.
  useEffect(() => {
    if (!running) removeRetainedZones();
  }, [running, lineResults, lineTimings, removeRetainedZones]);

  // Declared after the widget effect so its cleanup runs last and also
  // removes the rows that cleanup just retained.
  useEffect(() => removeRetainedZones, [removeRetainedZones]);

  return mounted;
}

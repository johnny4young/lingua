import { useCallback, useEffect, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import type { LineResult } from '../../stores/resultStore';
import type { LineTimingEntry } from '../../types/execution';
import { renderInlineResultNode } from './inlineResultWidgetDom';

const INLINE_RESULT_WIDGET_PREFIX = 'lingua.inlineResult';

export interface InlineResultWidgetsProps {
  readonly editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof monacoTypes | null;
  readonly lineResults: readonly LineResult[];
  readonly tabId: string | null;
  readonly lineTimings?: readonly LineTimingEntry[];
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
  lineTimings = [],
}: InlineResultWidgetsProps) {
  useInlineResultWidgets(editor, monaco, lineResults, tabId, lineTimings);
  return null;
}

interface InlineWidget {
  id: string;
  domNode: HTMLElement;
  line: number;
  zone?: { id: string; height: number };
}

/**
 * Right-aligned overlays stay inline while there is empty space after source.
 * A colliding or wrapped line gets a Monaco view zone beneath it, preserving
 * both source and result without shifting the document's model line numbers.
 */
function useInlineResultWidgets(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null,
  lineResults: readonly LineResult[],
  tabId: string | null,
  // per-statement timings from the last instrumented run.
  // Rendered as a trailing chip on the line's widget (or a standalone
  // widget for lines with no value result). Empty = feature inactive.
  lineTimings: readonly LineTimingEntry[] = []
) {
  const widgetsRef = useRef<Map<number, InlineWidget>>(new Map());
  const repositioningRef = useRef(false);
  const scheduledFrameRef = useRef<number | null>(null);
  const measurementGenerationRef = useRef(0);
  // Monaco shifts a view zone with inserted/deleted lines, while a widget
  // stays on the line its run reported. Re-anchor zones after such edits.
  const zonesMovedRef = useRef(false);

  const cancelMeasurement = useCallback(() => {
    measurementGenerationRef.current += 1;
    if (scheduledFrameRef.current !== null) {
      cancelAnimationFrame(scheduledFrameRef.current);
      scheduledFrameRef.current = null;
    }
  }, []);

  const removeAllWidgets = useCallback(() => {
    cancelMeasurement();
    if (!editor) return;
    repositioningRef.current = true;
    try {
      editor.changeViewZones(accessor => {
        for (const widget of widgetsRef.current.values()) {
          if (widget.zone) accessor.removeZone(widget.zone.id);
        }
      });
      for (const w of widgetsRef.current.values()) {
        try {
          editor.removeOverlayWidget({
            getId: () => w.id,
            getDomNode: () => w.domNode,
            getPosition: () => null,
          });
        } catch {
          /* widget already gone; ignore */
        }
      }
    } finally {
      widgetsRef.current.clear();
      repositioningRef.current = false;
    }
  }, [editor, cancelMeasurement]);

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
      const rightOffset = (layout.minimap.minimapWidth ?? 0) + layout.verticalScrollbarWidth + 12;
      const visibleRanges = editor.getVisibleRanges();
      const relocateZones = zonesMovedRef.current;
      zonesMovedRef.current = false;
      const changes: Array<{ widget: InlineWidget; height: number }> = [];
      for (const widget of widgetsRef.current.values()) {
        const valid = widget.line >= 1 && widget.line <= model.getLineCount();
        const visible =
          valid &&
          visibleRanges.some(
            range => widget.line >= range.startLineNumber && widget.line <= range.endLineNumber
          );
        widget.domNode.style.visibility = visible ? '' : 'hidden';
        // Monaco cannot measure columns on an unrendered line. Preserve its
        // reserved row while scrolling, avoiding document-height oscillation.
        if (valid && !visible) {
          if (relocateZones && widget.zone) changes.push({ widget, height: widget.zone.height });
          continue;
        }
        let height = 0;
        if (visible) {
          const rect = widget.domNode.getBoundingClientRect();
          const lineHeight = editor.getLineHeightForPosition({
            lineNumber: widget.line,
            column: 1,
          });
          const sourceOffset = editor.getOffsetForColumn(
            widget.line,
            model.getLineMaxColumn(widget.line)
          );
          const sourceEnd = layout.contentLeft + sourceOffset - editor.getScrollLeft();
          const widgetLeft = layout.width - rightOffset - rect.width;
          const wrapped =
            editor.getBottomForLineNumber(widget.line) - editor.getTopForLineNumber(widget.line) >
            lineHeight + 1;
          if (sourceOffset < 0 || wrapped || sourceEnd + 12 > widgetLeft) {
            height = Math.ceil(Math.max(lineHeight, rect.height + 6));
          }
        }
        const zoneHeight = widget.zone?.height ?? 0;
        if (zoneHeight !== height || (relocateZones && zoneHeight > 0)) {
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
              const id = accessor.addZone({
                afterLineNumber: widget.line,
                heightInPx: height,
                domNode: spacer,
                suppressMouseDown: true,
              });
              widget.zone = { id, height };
            }
          }
        });
      }
      // Adding a zone moves subsequent lines; read positions after the batch.
      const scrollTop = editor.getScrollTop();
      for (const widget of widgetsRef.current.values()) {
        if (widget.domNode.style.visibility === 'hidden') continue;
        const top = widget.zone
          ? editor.getBottomForLineNumber(widget.line)
          : editor.getTopForLineNumber(widget.line);
        widget.domNode.style.top = `${top - scrollTop}px`;
        widget.domNode.style.right = `${rightOffset}px`;
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
    if (!editor || repositioningRef.current || scheduledFrameRef.current !== null) return;
    const generation = measurementGenerationRef.current;
    scheduledFrameRef.current = requestAnimationFrame(() => {
      if (generation !== measurementGenerationRef.current) return;
      scheduledFrameRef.current = null;
      repositionAll();
    });
  }, [editor, repositionAll]);

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
        if (
          event.changes.some(
            change =>
              change.range.startLineNumber !== change.range.endLineNumber ||
              change.text.includes('\n')
          )
        ) {
          zonesMovedRef.current = true;
        }
        schedule();
      })
    );
    disposables.push(
      editor.onDidChangeModel(() => {
        // A model swap rebuilds Monaco's view and drops every view zone.
        for (const widget of widgetsRef.current.values()) widget.zone = undefined;
        schedule();
      })
    );
    return () => {
      active = false;
      cancelMeasurement();
      for (const d of disposables) d.dispose();
    };
  }, [editor, scheduleReposition, cancelMeasurement]);

  // Apply / re-apply widgets whenever the line results change.
  useEffect(() => {
    if (!editor || !monaco) return;
    removeAllWidgets();
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
    for (const [line, items] of grouped) {
      const timingMs = timingByLine.get(line);
      const domNode = renderInlineResultNode(
        items,
        timingMs === undefined ? undefined : { durationMs: timingMs, slowest: line === slowestLine }
      );
      domNode.setAttribute('data-line', String(line));
      // Overlay widgets are absolutely-positioned children of the
      // editor's overlay layer. We control position via inline style;
      // Monaco only places the host element on the page.
      domNode.style.position = 'absolute';
      domNode.style.pointerEvents = 'none';
      domNode.style.visibility = 'hidden';
      const id = `${INLINE_RESULT_WIDGET_PREFIX}.${tabId ?? 'none'}.${line}`;
      const widget: InlineWidget = { id, domNode, line };
      widgetsRef.current.set(line, widget);
      editor.addOverlayWidget({
        getId: () => id,
        getDomNode: () => domNode,
        // Returning `null` means "I'll place it myself via CSS top/right".
        getPosition: () => null,
      });
    }
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
      removeAllWidgets();
    };
  }, [editor, monaco, lineResults, lineTimings, tabId, removeAllWidgets, scheduleReposition]);
}

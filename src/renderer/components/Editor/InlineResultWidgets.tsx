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

  const removeAllWidgets = useCallback(() => {
    if (!editor) return;
    repositioningRef.current = true;
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
    widgetsRef.current.clear();
    repositioningRef.current = false;
  }, [editor]);

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
        if (valid && !visible) continue;
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
        if ((widget.zone?.height ?? 0) !== height) changes.push({ widget, height });
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

  // Wire scroll + layout listeners. Disposed on unmount / tab swap.
  useEffect(() => {
    if (!editor) return;
    const disposables: monacoTypes.IDisposable[] = [];
    disposables.push(editor.onDidScrollChange(() => repositionAll()));
    disposables.push(editor.onDidLayoutChange(() => repositionAll()));
    disposables.push(editor.onDidChangeConfiguration(() => repositionAll()));
    const model = editor.getModel();
    if (model) {
      disposables.push(model.onDidChangeContent(() => repositionAll()));
    }
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [editor, repositionAll]);

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
    repositionAll();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(repositionAll);
    for (const widget of widgetsRef.current.values()) observer?.observe(widget.domNode);
    return () => {
      observer?.disconnect();
      removeAllWidgets();
    };
  }, [editor, monaco, lineResults, lineTimings, tabId, removeAllWidgets, repositionAll]);
}

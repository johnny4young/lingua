import { useCallback, useEffect, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import type { LineResult } from '../../stores/resultStore';
import type { LineTimingEntry } from '../../types';
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
}

/**
 * Hook variant that renders inline results as **Monaco overlay
 * widgets** (internal polish #1). Each line with a result gets a
 * widget that floats at the editor's right edge — independent of the
 * code's actual end-of-line column — so values line up vertically
 * the way Quokka / RunJS do. The DOM carries the design's chrome:
 * `⟸ value · type-pill · ms · 📌 · @WATCH`.
 *
 * Overlay widgets sit on top of the editor's overlay layer (a single
 * absolutely-positioned host inside `.monaco-editor`), so we pin
 * each widget with `position: absolute; right: 12px; top: <px>` and
 * recompute `top` whenever the editor scrolls, the layout changes,
 * or the model edits (line counts can shift the line's `topForLine`).
 *
 * The hook used to use content widgets which Monaco places inline
 * after the line's last character; that approach left long lines
 * pushing the widget off-screen and short lines collapsing it to the
 * left of the canvas. Overlay widgets keep the right-edge alignment
 * stable regardless of code length.
 */
function useInlineResultWidgets(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null,
  lineResults: readonly LineResult[],
  tabId: string | null,
  // internal — per-statement timings from the last instrumented run.
  // Rendered as a trailing chip on the line's widget (or a standalone
  // widget for lines with no value result). Empty = feature inactive.
  lineTimings: readonly LineTimingEntry[] = []
) {
  const widgetsRef = useRef<Map<number, InlineWidget>>(new Map());

  const removeAllWidgets = useCallback(() => {
    if (!editor) return;
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
  }, [editor]);

  // Recompute every widget's `top` (and right gutter offset) when
  // anything that can shift line positions happens: scroll, layout,
  // model edits. Cheap O(widgets) — typically <50 lines per tab.
  const repositionAll = useCallback(() => {
    if (!editor) return;
    const layout = editor.getLayoutInfo();
    const scrollTop = editor.getScrollTop();
    // Right offset: leave room for the vertical scrollbar so the pill
    // doesn't collide with it. The minimap, when enabled, also lives
    // in `verticalScrollbarWidth` + `minimap.minimapWidth`.
    const rightOffset = (layout.minimap.minimapWidth ?? 0) + layout.verticalScrollbarWidth + 12;
    for (const widget of widgetsRef.current.values()) {
      const top = editor.getTopForLineNumber(widget.line) - scrollTop;
      widget.domNode.style.top = `${top}px`;
      widget.domNode.style.right = `${rightOffset}px`;
    }
  }, [editor]);

  // Wire scroll + layout listeners. Disposed on unmount / tab swap.
  useEffect(() => {
    if (!editor) return;
    const disposables: monacoTypes.IDisposable[] = [];
    disposables.push(editor.onDidScrollChange(() => repositionAll()));
    disposables.push(editor.onDidLayoutChange(() => repositionAll()));
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
    // internal — index the timings and find the run's hot spot. Lines
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
    return () => {
      removeAllWidgets();
    };
  }, [editor, monaco, lineResults, lineTimings, tabId, removeAllWidgets, repositionAll]);
}

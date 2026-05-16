import { useCallback, useEffect, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import type { LineResult } from '../stores/resultStore';
import {
  buildDiagnosticMarkerEntries,
  buildInlineDecorationEntries,
} from '../utils/editorExecutionDecorations';

const LINGUA_EXECUTION_MARKER_OWNER = 'lingua-execution';
const INLINE_RESULT_WIDGET_PREFIX = 'lingua.inlineResult';

/**
 * Hook for managing inline result decorations in Monaco Editor.
 * Shows execution output next to the lines that produced it (RunJS-style).
 */
export function useInlineResults() {
  const decorationsRef = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);

  /** Clear all inline decorations */
  const clearDecorations = useCallback(
    (editor: monacoTypes.editor.IStandaloneCodeEditor | null) => {
      if (decorationsRef.current) {
        decorationsRef.current.clear();
        decorationsRef.current = null;
      }
      // Also clear via editor if available
      if (editor) {
        const model = editor.getModel();
        if (model) {
          // Remove all inline-result decorations
          editor.removeDecorations(
            editor
              .getModel()
              ?.getAllDecorations()
              ?.filter((d) => d.options.className === 'inline-result-decoration')
              .map((d) => d.id) ?? []
          );
        }
      }
    },
    []
  );

  const clearMarkers = useCallback(
    (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null,
      monaco: typeof monacoTypes | null
    ) => {
      const model = editor?.getModel();
      if (!model || !monaco) {
        return;
      }

      monaco.editor.setModelMarkers(model, LINGUA_EXECUTION_MARKER_OWNER, []);
    },
    []
  );

  /** Apply inline decorations from console outputs */
  const applyDecorations = useCallback(
    (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null,
      lineResults: LineResult[],
      monaco: typeof monacoTypes
    ) => {
      if (!editor || !monaco) return;

      clearDecorations(editor);
      const decorationEntries = buildInlineDecorationEntries(lineResults);

      if (decorationEntries.length === 0) return;

      const decorations: monacoTypes.editor.IModelDeltaDecoration[] = [];

      for (const entry of decorationEntries) {
        decorations.push({
          range: new monaco.Range(entry.line, 1, entry.line, 1),
          options: {
            isWholeLine: true,
            className: 'inline-result-decoration',
            after: {
              content: entry.content,
              inlineClassName: 'inline-result-text',
            },
          },
        });
      }

      decorationsRef.current = editor.createDecorationsCollection(decorations);
    },
    [clearDecorations]
  );

  const applyDiagnostics = useCallback(
    (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null,
      diagnostics: Array<{
        message: string;
        line: number;
        column?: number;
        endLine?: number;
        endColumn?: number;
        severity: 'error' | 'warning' | 'info';
      }>,
      monaco: typeof monacoTypes | null
    ) => {
      if (!editor || !monaco) {
        return;
      }

      const model = editor.getModel();
      if (!model) {
        return;
      }

      const markerEntries = buildDiagnosticMarkerEntries(
        diagnostics,
        model.getLineCount(),
        (lineNumber) => model.getLineMaxColumn(lineNumber)
      );

      if (markerEntries.length === 0) {
        clearMarkers(editor, monaco);
        return;
      }

      monaco.editor.setModelMarkers(
        model,
        LINGUA_EXECUTION_MARKER_OWNER,
        markerEntries.map((markerEntry) => ({
          ...markerEntry,
          severity:
            markerEntry.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : markerEntry.severity === 'info'
                ? monaco.MarkerSeverity.Info
                : monaco.MarkerSeverity.Error,
        }))
      );
    },
    [clearMarkers]
  );

  return { applyDecorations, clearDecorations, applyDiagnostics, clearMarkers };
}

/* ============================================================ */
/* RL-093 Slice 3 — inline results as Monaco overlay widgets    */
/* ============================================================ */

/**
 * Cheap type inference over the displayed string. Mirrors the
 * heuristic used in the Stdin queue + Variables card. We can't know
 * the runtime type without re-parsing the host language; this fallback
 * is good enough to colour the type pill consistently.
 */
function inferKind(raw: string | undefined): string {
  if (raw === undefined || raw === '') return 'string';
  const s = raw.trim();
  if (s === 'true' || s === 'false') return 'boolean';
  if (s === 'undefined') return 'undefined';
  if (s === 'null') return 'null';
  if (/^-?\d+(\.\d+)?$/.test(s)) return 'number';
  if (s.startsWith('[') && s.endsWith(']')) return 'array';
  if (s.startsWith('{') && s.endsWith('}')) return 'object';
  if (s.startsWith('"') || s.startsWith("'")) return 'string';
  return 'string';
}

interface InlineWidget {
  id: string;
  domNode: HTMLElement;
  line: number;
}

export function isHiddenUndefinedLineResult(result: LineResult): boolean {
  // Watches stay visible even when their current value is `undefined`.
  // The user explicitly pinned the expression, so hiding it would erase
  // intent. Result/auto-log rows keep the existing hideUndefined filter.
  if (result.type === 'watch') return false;
  if (result.type === 'autoLog' && result.value === 'undefined') return true;
  return result.type === 'result' && result.value === 'undefined';
}

/**
 * Hook variant that renders inline results as **Monaco overlay
 * widgets** (RL-093 polish #1). Each line with a result gets a
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
export function useInlineResultWidgets(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null,
  lineResults: readonly LineResult[],
  tabId: string | null,
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
    const rightOffset =
      (layout.minimap.minimapWidth ?? 0) + layout.verticalScrollbarWidth + 12;
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
    for (const [line, items] of grouped) {
      const domNode = renderInlineResultNode(items);
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
  }, [editor, monaco, lineResults, tabId, removeAllWidgets, repositionAll]);
}

/**
 * Build the DOM node for a single line's inline-result widget.
 * The HTML follows the v2 mock: drop-arrow (⟸) · value · type pill ·
 * latency · 📌 / @WATCH where appropriate. Pure DOM (no React mount)
 * because overlay widgets re-use the same node across layouts and
 * mounting a React tree per line would be expensive.
 */
export function renderInlineResultNode(items: readonly LineResult[]): HTMLElement {
  const root = document.createElement('span');
  root.className = 'lingua-inline-result';
  root.setAttribute('data-testid', 'lingua-inline-result');

  for (let i = 0; i < items.length; i += 1) {
    const result = items[i];
    if (!result) continue;
    const isWatch = result.type === 'watch';
    const valueStr = String(result.value ?? '');
    const kind = inferKind(valueStr);
    const part = document.createElement('span');
    part.className = 'lingua-inline-result-part';

    if (isWatch) {
      const badge = document.createElement('span');
      badge.className = 'lingua-inline-result-watch';
      badge.textContent = '@WATCH';
      part.appendChild(badge);
    }

    const arrow = document.createElement('span');
    arrow.className = 'lingua-inline-result-arrow';
    arrow.textContent = '⟸';
    part.appendChild(arrow);

    const value = document.createElement('span');
    value.className = 'lingua-inline-result-value';
    value.textContent = valueStr;
    part.appendChild(value);

    const pill = document.createElement('span');
    pill.className = 'lingua-inline-result-pill';
    pill.setAttribute('data-type-pill', kind);
    pill.textContent = kind;
    part.appendChild(pill);

    root.appendChild(part);
    if (i < items.length - 1) {
      const dot = document.createElement('span');
      dot.className = 'lingua-inline-result-separator';
      dot.textContent = '·';
      root.appendChild(dot);
    }
  }
  return root;
}

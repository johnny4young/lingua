import { useEffect } from 'react';
import type * as monacoTypes from 'monaco-editor';

type Editor = monacoTypes.editor.IStandaloneCodeEditor;

export interface LineWidget {
  widget: monacoTypes.editor.IContentWidget;
  /** The line the widget sits on now; a tracked range follows it through edits. */
  currentLine: () => number;
  dispose: () => void;
}

/** Adds a content widget anchored below or at the end of a line, following the line through edits. */
export function createLineWidget(
  editor: Editor,
  monaco: typeof monacoTypes,
  line: number,
  node: HTMLElement,
  options: { id: string; placement: 'below' | 'line-end' }
): LineWidget {
  const tracker = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: {} }]);
  const currentLine = () => tracker.getRange(0)?.startLineNumber ?? line;
  const widget: monacoTypes.editor.IContentWidget = {
    getId: () => options.id,
    getDomNode: () => node,
    getPosition: () => {
      const current = currentLine();
      return options.placement === 'below'
        ? { position: { lineNumber: current, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.BELOW] }
        : {
            position: { lineNumber: current, column: editor.getModel()?.getLineMaxColumn(current) ?? 1 },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          };
    },
  };
  editor.addContentWidget(widget);
  return {
    widget,
    currentLine,
    dispose: () => {
      tracker.clear();
      editor.removeContentWidget(widget);
    },
  };
}

/**
 * A content widget anchored to a line that follows the line through edits.
 * Monaco caches a widget's size, so it is re-laid out on every edit and
 * whenever the node resizes.
 */
export function useLineWidget(
  editor: Editor | null,
  monaco: typeof monacoTypes | null,
  line: number | null,
  node: HTMLElement,
  options: { id: string; placement: 'below' | 'line-end' }
): void {
  const { id, placement } = options;
  useEffect(() => {
    if (!editor || !monaco || line === null) return;
    const model = editor.getModel();
    if (!model || line > model.getLineCount()) return;
    const { widget, dispose } = createLineWidget(editor, monaco, line, node, { id, placement });
    const relayout = () => editor.layoutContentWidget(widget);
    const edits = editor.onDidChangeModelContent(relayout);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout);
    resize?.observe(node);
    return () => {
      edits.dispose();
      resize?.disconnect();
      dispose();
    };
  }, [editor, monaco, line, node, id, placement]);
}

import { useEffect } from 'react';
import type * as monacoTypes from 'monaco-editor';

/**
 * A content widget anchored to a line that follows the line through edits
 * (a tracked range re-lays the widget out on every change).
 */
export function useLineWidget(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
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
    const tracker = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: {} }]);
    const widget: monacoTypes.editor.IContentWidget = {
      getId: () => id,
      getDomNode: () => node,
      getPosition: () => {
        const current = tracker.getRange(0)?.startLineNumber ?? line;
        return placement === 'below'
          ? { position: { lineNumber: current, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.BELOW] }
          : {
              position: { lineNumber: current, column: editor.getModel()?.getLineMaxColumn(current) ?? 1 },
              preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
            };
      },
    };
    editor.addContentWidget(widget);
    const edits = editor.onDidChangeModelContent(() => editor.layoutContentWidget(widget));
    return () => {
      edits.dispose();
      tracker.clear();
      editor.removeContentWidget(widget);
    };
  }, [editor, monaco, line, node, id, placement]);
}

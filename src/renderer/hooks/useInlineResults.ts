import { useCallback, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import type { LineResult } from '../stores/resultStore';
import type { ExecutionError } from '../types';

const RUNLANG_EXECUTION_MARKER_OWNER = 'runlang-execution';

function toInlineContent(result: LineResult): string {
  switch (result.type) {
    case 'magic':
    case 'result':
      return `  // => ${result.value}`;
    default:
      return `  // ${result.value}`;
  }
}

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

      monaco.editor.setModelMarkers(model, RUNLANG_EXECUTION_MARKER_OWNER, []);
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

      // Group outputs by line
      const lineOutputs = new Map<number, string[]>();
      for (const lineResult of lineResults) {
        const existing = lineOutputs.get(lineResult.line) ?? [];
        existing.push(toInlineContent(lineResult));
        lineOutputs.set(lineResult.line, existing);
      }

      if (lineOutputs.size === 0) return;

      const decorations: monacoTypes.editor.IModelDeltaDecoration[] = [];

      for (const [line, values] of lineOutputs) {
        const text = values.join(' ');
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'inline-result-decoration',
            after: {
              content: text,
              inlineClassName: 'inline-result-text',
            },
          },
        });
      }

      decorationsRef.current = editor.createDecorationsCollection(decorations);
    },
    [clearDecorations]
  );

  const applyErrorMarker = useCallback(
    (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null,
      error: ExecutionError | null,
      monaco: typeof monacoTypes | null
    ) => {
      if (!editor || !monaco) {
        return;
      }

      const model = editor.getModel();
      if (!model) {
        return;
      }

      if (error?.line === undefined) {
        clearMarkers(editor, monaco);
        return;
      }

      const startLineNumber = Math.min(Math.max(error.line, 1), model.getLineCount());
      const maxColumn = Math.max(model.getLineMaxColumn(startLineNumber), 1);
      const startColumn = Math.min(Math.max(error.column ?? 1, 1), maxColumn);
      const endColumn = error.column !== undefined ? Math.min(startColumn + 1, maxColumn) : maxColumn;

      monaco.editor.setModelMarkers(model, RUNLANG_EXECUTION_MARKER_OWNER, [
        {
          startLineNumber,
          endLineNumber: startLineNumber,
          startColumn,
          endColumn,
          severity: monaco.MarkerSeverity.Error,
          message: error.message,
        },
      ]);
    },
    [clearMarkers]
  );

  return { applyDecorations, clearDecorations, applyErrorMarker, clearMarkers };
}

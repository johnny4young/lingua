import { useCallback, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import type { LineResult } from '../stores/resultStore';
import {
  buildDiagnosticMarkerEntries,
  buildInlineDecorationEntries,
} from '../utils/editorExecutionDecorations';

const LINGUA_EXECUTION_MARKER_OWNER = 'lingua-execution';

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

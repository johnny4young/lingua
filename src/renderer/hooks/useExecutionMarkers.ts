import { useCallback } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { buildDiagnosticMarkerEntries } from '../utils/editorExecutionDecorations';

const LINGUA_EXECUTION_MARKER_OWNER = 'lingua-execution';

/**
 * Keep execution diagnostics synchronized with the active Monaco model.
 *
 * Marker support stays in the editor startup graph because compile/runtime
 * diagnostics can arrive without line-result widgets. The visual result
 * overlay is activation-scoped separately.
 */
export function useExecutionMarkers() {
  const clearMarkers = useCallback(
    (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null,
      monaco: typeof monacoTypes | null
    ) => {
      const model = editor?.getModel();
      if (!model || !monaco) return;
      monaco.editor.setModelMarkers(model, LINGUA_EXECUTION_MARKER_OWNER, []);
    },
    []
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
      if (!editor || !monaco) return;
      const model = editor.getModel();
      if (!model) return;

      const markerEntries = buildDiagnosticMarkerEntries(
        diagnostics,
        model.getLineCount(),
        lineNumber => model.getLineMaxColumn(lineNumber)
      );

      if (markerEntries.length === 0) {
        clearMarkers(editor, monaco);
        return;
      }

      monaco.editor.setModelMarkers(
        model,
        LINGUA_EXECUTION_MARKER_OWNER,
        markerEntries.map(markerEntry => ({
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

  return { applyDiagnostics, clearMarkers };
}

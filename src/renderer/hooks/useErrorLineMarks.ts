import { useEffect, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { useResultStore } from '../stores/resultStore';

/**
 * The line a run failed on: a red tint that fades in over 160 ms and an alert
 * mark in the glyph margin, instead of a toast. The inline error row with its
 * actions is mounted separately, on demand.
 */
export function useErrorLineMarks(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco: typeof monacoTypes | null
): void {
  const line = useResultStore((state) => state.error?.line ?? null);
  const decorationsRef = useRef<monacoTypes.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (line === null || !Number.isInteger(line) || line < 1 || !model || line > model.getLineCount()) {
      decorationsRef.current?.clear();
      return;
    }
    const decorations = [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'lingua-error-line', glyphMarginClassName: 'lingua-error-glyph' },
      },
    ];
    if (decorationsRef.current) decorationsRef.current.set(decorations);
    else decorationsRef.current = editor.createDecorationsCollection(decorations);
  }, [editor, monaco, line]);

  useEffect(
    () => () => {
      decorationsRef.current?.clear();
      decorationsRef.current = null;
    },
    []
  );
}

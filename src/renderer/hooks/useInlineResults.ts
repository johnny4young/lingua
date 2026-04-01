import { useCallback, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor';
import type { ConsoleOutput } from '../types';

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

  /** Apply inline decorations from console outputs */
  const applyDecorations = useCallback(
    (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null,
      outputs: ConsoleOutput[],
      monaco: typeof monacoTypes
    ) => {
      if (!editor || !monaco) return;

      clearDecorations(editor);

      // Group outputs by line
      const lineOutputs = new Map<number, string[]>();
      for (const output of outputs) {
        if (output.line !== undefined) {
          const existing = lineOutputs.get(output.line) ?? [];
          existing.push(output.args.join(' '));
          lineOutputs.set(output.line, existing);
        }
      }

      if (lineOutputs.size === 0) return;

      const decorations: monacoTypes.editor.IModelDeltaDecoration[] = [];

      for (const [line, values] of lineOutputs) {
        const text = values.join(', ');
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'inline-result-decoration',
            after: {
              content: `  // => ${text}`,
              inlineClassName: 'inline-result-text',
            },
          },
        });
      }

      decorationsRef.current = editor.createDecorationsCollection(decorations);
    },
    [clearDecorations]
  );

  return { applyDecorations, clearDecorations };
}

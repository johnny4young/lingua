import { useEffect, useState } from 'react';
import type * as monacoTypes from 'monaco-editor';
import {
  getActiveEditor,
  getActiveEditorCursorPosition,
  getActiveMonaco,
  subscribeActiveEditor,
} from '../../runtime/editorAccess';

/**
 * internal — editor-derived data the persistent status bar renders.
 *
 * Every field degrades to a quiet default (null cursor/indent, 0/0 lint
 * counts) when no editor / model / monaco namespace is registered, so the
 * bar never throws and never shows stale data from a torn-down editor.
 */
export interface StatusBarModel {
  /** 1-based cursor line + column, or null when no editor / position. */
  cursor: { line: number; column: number } | null;
  /** Error-severity marker count for the active model (0 when none). */
  lintErrors: number;
  /** Warning-severity marker count for the active model (0 when none). */
  lintWarnings: number;
  /** Active model's indentation, or null when no editor / model. */
  indent: { insertSpaces: boolean; tabSize: number } | null;
}

/**
 * internal — subscribe to the active editor and surface cursor position, indent
 * options, and lint marker counts as React state for the status bar.
 *
 * Re-binding model: a single effect (run once on mount) subscribes via
 * `subscribeActiveEditor`. The subscription fires on every active-editor swap
 * (mount / unmount / tab switch). On each swap we tear down the previous
 * editor's listeners and re-attach to the new instance, so the bar tracks
 * whichever editor is focused without remounting. The effect's cleanup
 * disposes both the active-editor subscription AND any per-editor listeners,
 * which makes the hook StrictMode-safe (double-invoke leaves no dangling
 * Monaco disposables).
 *
 * Lint counts read markers from the monaco namespace
 * (`editor.getModelMarkers({ resource })`) and recompute on
 * `editor.onDidChangeMarkers`. When monaco or the model is unavailable the
 * counts stay 0/0.
 */
export function useStatusBarModel(): StatusBarModel {
  const [cursor, setCursor] = useState<StatusBarModel['cursor']>(null);
  const [lintErrors, setLintErrors] = useState(0);
  const [lintWarnings, setLintWarnings] = useState(0);
  const [indent, setIndent] = useState<StatusBarModel['indent']>(null);

  useEffect(() => {
    // Disposables for the CURRENTLY-bound editor. Replaced wholesale on each
    // active-editor swap; emptied on unmount.
    let editorDisposables: monacoTypes.IDisposable[] = [];

    const readIndent = (
      editor: monacoTypes.editor.IStandaloneCodeEditor
    ): void => {
      const options = editor.getModel()?.getOptions();
      setIndent(
        options
          ? { insertSpaces: options.insertSpaces, tabSize: options.tabSize }
          : null
      );
    };

    const readCursor = (): void => {
      setCursor(getActiveEditorCursorPosition());
    };

    const readMarkers = (
      editor: monacoTypes.editor.IStandaloneCodeEditor
    ): void => {
      const monaco = getActiveMonaco();
      const model = editor.getModel();
      if (!monaco || !model) {
        setLintErrors(0);
        setLintWarnings(0);
        return;
      }
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      let errors = 0;
      let warnings = 0;
      for (const marker of markers) {
        if (marker.severity === monaco.MarkerSeverity.Error) errors += 1;
        else if (marker.severity === monaco.MarkerSeverity.Warning)
          warnings += 1;
      }
      setLintErrors(errors);
      setLintWarnings(warnings);
    };

    const disposeEditorListeners = (): void => {
      for (const disposable of editorDisposables) {
        disposable.dispose();
      }
      editorDisposables = [];
    };

    const bind = (
      editor: monacoTypes.editor.IStandaloneCodeEditor | null
    ): void => {
      disposeEditorListeners();
      if (!editor) {
        setCursor(null);
        setIndent(null);
        setLintErrors(0);
        setLintWarnings(0);
        return;
      }

      // Initial read for the freshly-bound editor.
      readCursor();
      readIndent(editor);
      readMarkers(editor);

      editorDisposables.push(
        editor.onDidChangeCursorPosition(() => {
          readCursor();
          // Indent options can change without a model swap (e.g. the user
          // cycles the indent segment), so re-read on cursor moves too.
          readIndent(editor);
        }),
        editor.onDidChangeModel(() => {
          readCursor();
          readIndent(editor);
          readMarkers(editor);
        })
      );

      // Marker changes (lint diagnostics) come from the monaco namespace, not
      // the editor instance. Recompute only when the changed resource is the
      // active model's uri so unrelated tabs don't churn the counts.
      const monaco = getActiveMonaco();
      if (monaco) {
        editorDisposables.push(
          monaco.editor.onDidChangeMarkers((resources) => {
            const model = editor.getModel();
            if (!model) {
              readMarkers(editor);
              return;
            }
            const uri = model.uri.toString();
            if (resources.some((resource) => resource.toString() === uri)) {
              readMarkers(editor);
            }
          })
        );
      }
    };

    const unsubscribe = subscribeActiveEditor(bind);
    // Bind the editor that is ALREADY active when the bar mounts — the
    // subscription only fires on future swaps, so the current instance
    // (the common case: editor mounted before the bar) needs an explicit
    // initial bind.
    bind(getActiveEditor());

    return () => {
      unsubscribe();
      disposeEditorListeners();
    };
  }, []);

  return { cursor, lintErrors, lintWarnings, indent };
}

import type * as monacoTypes from 'monaco-editor';

/**
 * RL-027 Slice 1.5 fold C — module-level access to the active Monaco
 * editor so the global shortcut bus can read the current cursor line
 * without piping a ref through the entire renderer tree.
 *
 * Same shape as `debuggerWorkerBridge`: a single mutable handle that
 * `CodeEditor` writes on mount and clears on unmount. The shortcut
 * handler reads it; if nothing is registered (no editor yet, or web
 * preview not on a code tab) the keystroke is a no-op.
 *
 * Why module-level vs a Zustand selector: cursor changes fire dozens
 * of times per second when scrolling with the arrow keys, and we do
 * not want every selector subscriber re-rendering on each tick. The
 * module-level ref is read-on-demand from the keydown handler and
 * never participates in React render cycles.
 *
 * RL-112 — the persistent status bar also needs the active editor (cursor
 * position, indent, markers) and the monaco namespace (marker severities +
 * `getModelMarkers`). It cannot read on demand only: the bar must re-bind its
 * listeners whenever the active editor instance swaps. So this module now also
 * stores the `monaco` namespace alongside the editor and exposes a tiny
 * subscriber registry the status-bar hook drives.
 */

const ref: {
  editor: monacoTypes.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoTypes | null;
} = { editor: null, monaco: null };

/**
 * RL-112 — listeners notified whenever the active editor instance changes
 * (mount / unmount / tab swap). The status-bar model hook subscribes so it can
 * dispose and re-attach its per-editor listeners on the new instance.
 */
const editorListeners = new Set<
  (editor: monacoTypes.editor.IStandaloneCodeEditor | null) => void
>();

export function setActiveEditor(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null,
  monaco?: typeof monacoTypes
): void {
  ref.editor = editor;
  // RL-112 — keep the last-known monaco namespace when the editor unmounts
  // (`setActiveEditor(null)` passes no monaco) so a re-mount that omits it
  // still has the namespace available.
  ref.monaco = monaco ?? ref.monaco;
  for (const listener of editorListeners) {
    listener(editor);
  }
}

/**
 * RL-110 fold D — return the active Monaco editor instance (or null). Used by
 * the command-palette "Paste as plain text" action to drive a detection-
 * bypassing paste without threading the editor ref through the palette tree.
 */
export function getActiveEditor(): monacoTypes.editor.IStandaloneCodeEditor | null {
  return ref.editor;
}

/**
 * RL-112 — return the active Monaco namespace (or null). The status bar reads
 * marker severities (`MarkerSeverity`) and `editor.getModelMarkers` /
 * `editor.onDidChangeMarkers` from it to compute lint counts.
 */
export function getActiveMonaco(): typeof monacoTypes | null {
  return ref.monaco;
}

/**
 * RL-112 — subscribe to active-editor changes. Returns an unsubscribe. The
 * status-bar model hook uses this to re-bind its per-editor listeners whenever
 * the active editor instance swaps (mount / unmount / tab switch).
 */
export function subscribeActiveEditor(
  listener: (editor: monacoTypes.editor.IStandaloneCodeEditor | null) => void
): () => void {
  editorListeners.add(listener);
  return () => {
    editorListeners.delete(listener);
  };
}

export function getActiveEditorCursorLine(): number | null {
  const editor = ref.editor;
  if (!editor) return null;
  const position = editor.getPosition();
  if (!position || typeof position.lineNumber !== 'number') return null;
  return position.lineNumber > 0 ? position.lineNumber : null;
}

/**
 * RL-112 — read the active editor's full cursor position (1-based line +
 * column). Returns null when no editor is registered or the position is
 * unavailable / out of range. Used by the status bar's cursor segment.
 */
export function getActiveEditorCursorPosition(): {
  line: number;
  column: number;
} | null {
  const editor = ref.editor;
  if (!editor) return null;
  const position = editor.getPosition();
  if (
    !position ||
    typeof position.lineNumber !== 'number' ||
    typeof position.column !== 'number'
  ) {
    return null;
  }
  if (position.lineNumber < 1 || position.column < 1) return null;
  return { line: position.lineNumber, column: position.column };
}

/**
 * RL-020 Slice 3 fold E — read the active editor's current line text
 * (without trailing newline). Used by the "Pin watch on current line"
 * command-palette action to derive a sensible default expression
 * from whatever the user's cursor sits on. Returns `null` when no
 * editor is registered or when the cursor line is out of range.
 */
export function getActiveEditorLineText(): string | null {
  const editor = ref.editor;
  if (!editor) return null;
  const position = editor.getPosition();
  if (!position || typeof position.lineNumber !== 'number') return null;
  const model = editor.getModel();
  if (!model) return null;
  const line = position.lineNumber;
  if (line < 1 || line > model.getLineCount()) return null;
  return model.getLineContent(line);
}

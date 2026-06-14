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
 */

const ref: { editor: monacoTypes.editor.IStandaloneCodeEditor | null } = { editor: null };

export function setActiveEditor(
  editor: monacoTypes.editor.IStandaloneCodeEditor | null
): void {
  ref.editor = editor;
}

/**
 * RL-110 fold D — return the active Monaco editor instance (or null). Used by
 * the command-palette "Paste as plain text" action to drive a detection-
 * bypassing paste without threading the editor ref through the palette tree.
 */
export function getActiveEditor(): monacoTypes.editor.IStandaloneCodeEditor | null {
  return ref.editor;
}

export function getActiveEditorCursorLine(): number | null {
  const editor = ref.editor;
  if (!editor) return null;
  const position = editor.getPosition();
  if (!position || typeof position.lineNumber !== 'number') return null;
  return position.lineNumber > 0 ? position.lineNumber : null;
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

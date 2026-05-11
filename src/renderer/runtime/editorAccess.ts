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

export function getActiveEditorCursorLine(): number | null {
  const editor = ref.editor;
  if (!editor) return null;
  const position = editor.getPosition();
  if (!position || typeof position.lineNumber !== 'number') return null;
  return position.lineNumber > 0 ? position.lineNumber : null;
}

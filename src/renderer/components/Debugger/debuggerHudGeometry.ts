import type * as monacoTypes from 'monaco-editor';

/** Height of the row the step HUD reserves under the paused line; answers placed under that line start below it. */
export const DEBUGGER_HUD_HEIGHT = 46;

type Editor = monacoTypes.editor.ICodeEditor;

const hudLines = new WeakMap<Editor, () => number>();

/** The HUD publishes the line its row sits under now, which edits move away from the paused frame's line. */
export function setStepHudLine(editor: Editor, line: (() => number) | null): void {
  if (line) hudLines.set(editor, line);
  else hudLines.delete(editor);
}

export function stepHudLine(editor: Editor): number | null {
  return hudLines.get(editor)?.() ?? null;
}

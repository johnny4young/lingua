import type * as monacoTypes from 'monaco-editor';

const RIGHT_PAD = 22;

/**
 * The answer column every editor answer lines up in: its start and width,
 * measured from the left edge of the visible content area.
 */
export function answerColumnBand(layout: Pick<monacoTypes.editor.EditorLayoutInfo, 'contentWidth'>): { start: number; width: number } {
  const width = Math.round(Math.min(680, Math.max(280, layout.contentWidth * 0.42)));
  return { start: Math.max(0, layout.contentWidth - RIGHT_PAD - width), width };
}

/** Where a line's text ends in content coordinates, or null while Monaco has not rendered it. */
export function lineEnd(editor: monacoTypes.editor.IStandaloneCodeEditor, line: number): number | null {
  const model = editor.getModel();
  if (!model || line < 1 || line > model.getLineCount()) return null;
  const offset = editor.getOffsetForColumn(line, model.getLineMaxColumn(line));
  return offset >= 0 ? offset : null;
}

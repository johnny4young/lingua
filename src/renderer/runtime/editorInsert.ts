import type * as monacoTypes from 'monaco-editor';
import { create } from 'zustand';
import type { CodeCursor } from './editorAccess';

type Editor = monacoTypes.editor.IStandaloneCodeEditor;

/** Text for the code editor to insert once it shows `tabId`. */
export interface EditorInsert extends CodeCursor {
  readonly text: string;
  /** Called with the first and last inserted line once the edit lands. */
  readonly onInserted?: (editor: Editor, monaco: typeof monacoTypes, from: number, to: number) => void;
}

export const useEditorInsertStore = create<{ request: EditorInsert | null }>(() => ({ request: null }));

/** Queue an insert; the code editor applies it when it shows the tab, and drops it for any other tab. */
export function requestEditorInsert(request: EditorInsert): void {
  useEditorInsertStore.setState({ request });
}

/** Insert at the request's position as one undo step and leave the cursor after it. */
export function applyEditorInsert(editor: Editor, monaco: typeof monacoTypes, request: EditorInsert): void {
  const model = editor.getModel();
  if (!model) return;
  const start = model.validatePosition({ lineNumber: request.line, column: request.column });
  const text = request.text.replace(/\r\n|\r|\n/gu, model.getEOL());
  editor.pushUndoStop();
  if (!editor.executeEdits('lingua.insert', [{ range: monaco.Range.fromPositions(start), text, forceMoveMarkers: true }])) return;
  editor.pushUndoStop();
  const end = model.getPositionAt(model.getOffsetAt(start) + text.length);
  editor.setPosition(end);
  editor.revealRangeInCenterIfOutsideViewport(monaco.Range.fromPositions(start, end));
  editor.focus();
  // Text that ends in a line break leaves the cursor on a line it never wrote.
  const last = end.column === 1 && end.lineNumber > start.lineNumber ? end.lineNumber - 1 : end.lineNumber;
  request.onInserted?.(editor, monaco, start.lineNumber, last);
}

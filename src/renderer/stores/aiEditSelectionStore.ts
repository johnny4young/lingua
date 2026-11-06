import type * as monacoTypes from 'monaco-editor';
import { create } from 'zustand';

/** What "Edit selection with AI" works on: the file, the span to rewrite and the model version it was taken from. */
export interface EditSelectionRequest {
  readonly code: string;
  readonly start: number;
  readonly end: number;
  readonly language: string;
  readonly filename?: string;
  /** Accept writes only into this model at this version, so an edit in between cannot be overwritten. */
  readonly modelUri: string;
  readonly versionId: number;
  readonly tabId?: string;
}

interface AiEditSelectionState {
  readonly request: EditSelectionRequest | null;
  readonly open: (request: EditSelectionRequest) => void;
  readonly close: () => void;
}

export const useAiEditSelectionStore = create<AiEditSelectionState>(set => ({
  request: null,
  open: request => set({ request }),
  close: () => set({ request: null }),
}));

/** The selection, or the whole buffer when nothing is selected; nothing for an empty buffer. */
export function openEditSelectionForEditor(editor: monacoTypes.editor.ICodeEditor, language: string, filename?: string, tabId?: string): void {
  const model = editor.getModel();
  if (!model) return;
  const code = model.getValue();
  if (code.trim().length === 0) return;
  const selection = editor.getSelection();
  const whole = !selection || selection.isEmpty();
  const start = whole ? 0 : model.getOffsetAt(selection.getStartPosition());
  const end = whole ? code.length : model.getOffsetAt(selection.getEndPosition());
  useAiEditSelectionStore.getState().open({
    code,
    start,
    end,
    language,
    ...(filename ? { filename } : {}),
    ...(tabId ? { tabId } : {}),
    modelUri: model.uri.toString(),
    versionId: model.getVersionId(),
  });
}

import type * as monacoTypes from 'monaco-editor';
import { create } from 'zustand';

/**
 * internal  — a single open-request slot for the "Explain this code"
 * dialog, so the same dialog can be opened from BOTH the editor
 * context-menu action AND the command palette without threading state
 * through the component tree. Not persisted; cleared on close.
 */
export interface ExplainCodeOpenRequest {
  readonly code: string;
  readonly language: string;
  readonly filename?: string;
}

interface AiExplainCodeState {
  readonly request: ExplainCodeOpenRequest | null;
  readonly open: (request: ExplainCodeOpenRequest) => void;
  readonly close: () => void;
}

export const useAiExplainCodeStore = create<AiExplainCodeState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/**
 * Derive the excerpt to explain from a Monaco editor — the current
 * selection, or the whole buffer when nothing is selected — and open the
 * dialog. Shared by the editor context-menu action and the palette
 * command so the "selection vs buffer" rule lives in exactly one place.
 * No-op when the buffer is empty.
 */
export function openExplainCodeForEditor(
  // ICodeEditor is the common supertype of the standalone editor
  // (getActiveEditor) and the instance the Monaco action's `run` receives.
  editor: monacoTypes.editor.ICodeEditor,
  language: string,
  filename?: string
): void {
  const model = editor.getModel();
  if (!model) return;
  const selection = editor.getSelection();
  const code =
    selection && !selection.isEmpty()
      ? model.getValueInRange(selection)
      : model.getValue();
  if (code.trim().length === 0) return;
  useAiExplainCodeStore.getState().open(
    filename ? { code, language, filename } : { code, language }
  );
}

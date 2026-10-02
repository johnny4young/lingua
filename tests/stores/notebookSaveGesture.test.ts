import { beforeEach, describe, expect, it, vi } from 'vitest';
const { document, save } = vi.hoisted(() => ({
  document: { value: 'before gesture' },
  save: vi.fn(async (_id: string, _saveAs = false, _snapshot?: string | null) => true),
}));
vi.mock('../../src/renderer/stores/notebookDocumentPersistence', () => ({
  notebookDocumentSnapshot: () => document.value,
  notebookDocumentNotice: vi.fn(),
}));
vi.mock('../../src/renderer/stores/editorDocumentSave', () => ({
  createDocumentSaveAction: () => save,
}));
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { registerNotebookDocumentDraft } from '../../src/renderer/stores/notebookDocumentDrafts';

beforeEach(() => {
  save.mockClear();
  document.value = 'before gesture';
  useEditorStore.setState({
    tabs: [
      {
        id: 'notebook',
        name: 'notes.linguanb',
        kind: 'notebook',
        language: 'javascript',
        content: 'saved baseline',
        isDirty: true,
      },
    ],
    activeTabId: 'notebook',
  });
});
describe('manual notebook save gesture snapshot', () => {
  it('freezes the requested document before any lazy import or queued lock', async () => {
    const saving = useEditorStore.getState().saveTabById('notebook');
    document.value = 'edited after gesture';
    await saving;
    expect(save).toHaveBeenCalledExactlyOnceWith('notebook', false, 'before gesture');
  });
  it('includes the last mounted draft before freezing Save As', async () => {
    const unregister = registerNotebookDocumentDraft('notebook', () => {
      document.value = 'last typed draft';
    });
    try {
      const saving = useEditorStore.getState().saveTabById('notebook', true);
      document.value = 'typed during save';
      await saving;
      expect(save).toHaveBeenCalledExactlyOnceWith('notebook', true, 'last typed draft');
    } finally {
      unregister();
    }
  });
});

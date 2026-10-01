import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { NotebookDocumentActions } from '../../../src/renderer/components/Notebook/NotebookDocumentActions';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';

const initialEditor = useEditorStore.getState();
const initialPush = useUIStore.getState().pushStatusNotice;

afterEach(() => {
  useEditorStore.setState(initialEditor, true);
  useUIStore.setState({ pushStatusNotice: initialPush });
});

describe('NotebookDocumentActions', () => {
  it.each(['notebook-document-save', 'notebook-document-save-as'])(
    'reports a rejected %s gesture instead of leaking it',
    async testId => {
      const notices = vi.fn();
      useUIStore.setState({ pushStatusNotice: notices });
      useEditorStore.setState({
        saveTabById: vi.fn().mockRejectedValue(new Error('chunk load failed')),
      });
      const { getByTestId } = render(<NotebookDocumentActions tabId="tab" />);
      fireEvent.click(getByTestId(testId));
      await waitFor(() =>
        expect(notices).toHaveBeenCalledWith(
          expect.objectContaining({ messageKey: 'notebook.document.writeFailed' })
        )
      );
    }
  );
});

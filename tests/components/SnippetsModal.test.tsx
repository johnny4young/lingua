import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnippetsModal } from '../../src/renderer/components/Snippets';
import { useEditorStore } from '@/stores/editorStore';
import { useSnippetsStore } from '@/stores/snippetsStore';

describe('SnippetsModal', () => {
  beforeEach(() => {
    useSnippetsStore.setState({ snippets: [] });
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
      addTab: useEditorStore.getState().addTab,
      removeTab: useEditorStore.getState().removeTab,
      setActiveTab: useEditorStore.getState().setActiveTab,
      updateContent: useEditorStore.getState().updateContent,
      markSaved: useEditorStore.getState().markSaved,
      openFile: useEditorStore.getState().openFile,
      saveActiveTab: useEditorStore.getState().saveActiveTab,
    });
  });

  it('can save the active tab as a snippet and edit it', async () => {
    const user = userEvent.setup();

    useEditorStore.setState({
      ...useEditorStore.getState(),
      tabs: [
        {
          id: 'tab-1',
          name: 'math.ts',
          language: 'typescript',
          content: 'export const total = 1 + 2;',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    });

    render(<SnippetsModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save Active Tab' }));

    const nameInput = screen.getByLabelText('Name');
    expect((nameInput as HTMLInputElement).value).toBe('math');

    await user.clear(nameInput);
    await user.type(nameInput, 'Math Helper');
    await user.click(screen.getByRole('button', { name: 'Save Snippet' }));

    const [snippet] = useSnippetsStore.getState().snippets;
    expect(snippet).toEqual(
      expect.objectContaining({
        label: 'Math Helper',
        language: 'typescript',
        code: 'export const total = 1 + 2;',
      })
    );
  });

  it('can insert a saved snippet into the active tab', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const snippetId = useSnippetsStore.getState().addSnippet({
      label: 'Console',
      description: 'Logging helper',
      language: 'javascript',
      code: 'console.log("snippet");',
    });

    useEditorStore.setState({
      ...useEditorStore.getState(),
      tabs: [
        {
          id: 'tab-1',
          name: 'main.js',
          language: 'javascript',
          content: 'const value = 1;',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    });

    render(<SnippetsModal onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Insert into Active Tab' }));

    const updatedTab = useEditorStore.getState().tabs.find((tab) => tab.id === 'tab-1');
    expect(updatedTab?.content).toContain('const value = 1;');
    expect(updatedTab?.content).toContain('console.log("snippet");');
    expect(updatedTab?.isDirty).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useSnippetsStore.getState().snippets[0].id).toBe(snippetId);
  });

  it('can delete an existing snippet', async () => {
    const user = userEvent.setup();

    useSnippetsStore.getState().addSnippet({
      label: 'Delete Me',
      description: '',
      language: 'python',
      code: 'print("bye")',
    });

    render(<SnippetsModal onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
    expect(screen.getByText('No snippets saved yet.')).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { editor, Uri } from 'monaco-editor';
import { createLspEditorOpener } from '../../../src/renderer/components/Editor/lspEditorOpener';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { asRootId, asRelativePath } from '../../../src/shared/fs/brandedIds';

const originalBridge = window.lingua;
const originalEditor = useEditorStore.getState();
const originalProject = useProjectStore.getState();
const rootId = asRootId('approved-root');
const source = { getModel: () => model } as unknown as editor.ICodeEditor;
const model = { getVersionId: () => 1 };
const resource = { toString: () => 'file:///project/helper.go' } as Uri;
const selection = { lineNumber: 3, column: 4 };
const openFile = vi.fn();
const reveal = vi.fn();

beforeEach(() => {
  openFile.mockReset();
  reveal.mockReset();
  window.lingua = {
    ...originalBridge,
    lsp: { ...originalBridge?.lsp, resolveTarget: vi.fn(async () => asRelativePath('helper.go')) },
  } as typeof window.lingua;
  useProjectStore.setState({ currentProject: { rootId, rootPath: '/project', name: 'project' } });
  useEditorStore.setState({
    tabs: ['main', 'helper', 'other'].map(id => ({
      id,
      name: `${id}.go`,
      language: 'go',
      content: `dirty ${id}`,
      isDirty: true,
      rootId,
      relativePath: `${id}.go`,
      filePath: `/project/${id}.go`,
    })),
    activeTabId: 'main',
    openFile,
    requestReveal: reveal,
  });
});
afterEach(() => {
  window.lingua = originalBridge;
  useEditorStore.setState(originalEditor);
  useProjectStore.setState(originalProject);
});

describe('project destination opener completion', () => {
  it('reveals the selected range only after the target buffer was focused', async () => {
    openFile.mockImplementation(async () => useEditorStore.setState({ activeTabId: 'helper' }));
    expect(await createLspEditorOpener().openCodeEditor(source, resource, selection)).toBe(true);
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ tabId: 'helper', line: 3, column: 4 });
    expect(useEditorStore.getState().tabs[1].content).toBe('dirty helper');
  });
  it.each(['unopened', 'tab-changed'] as const)(
    'discards %s opens without queuing a future reveal',
    async mode => {
      openFile.mockImplementation(async () => {
        if (mode === 'tab-changed') useEditorStore.setState({ activeTabId: 'other' });
      });
      expect(await createLspEditorOpener().openCodeEditor(source, resource, selection)).toBe(false);
      expect(reveal).not.toHaveBeenCalled();
      expect(useEditorStore.getState().activeTabId).toBe(mode === 'unopened' ? 'main' : 'other');
    }
  );
  it('discards a changed project while the file opener is awaited', async () => {
    openFile.mockImplementation(async () => useProjectStore.setState({ currentProject: null }));
    expect(await createLspEditorOpener().openCodeEditor(source, resource, selection)).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });
});

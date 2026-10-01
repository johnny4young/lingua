import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import type { LspLanguageIntelligenceAdapter } from '../../../src/renderer/languageIntelligence/types';
import { createLspNavigationProviders } from '../../../src/renderer/components/Editor/completionProviders/lspNavigationProvider';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { asRootId, asRelativePath } from '../../../src/shared/fs/brandedIds';

const range = { start: { line: 2, character: 3 }, end: { line: 2, character: 9 } };
const original = window.lingua;
const rootId = asRootId('approved-project');
const monaco = {
  Uri: { parse: (value: string) => ({ toString: () => value }) },
} as unknown as Monaco;
let version = 1;
const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
const model = {
  uri: { toString: () => 'file:///project/main.go' },
  getValue: () => 'current dirty source',
  getVersionId: () => version,
  isDisposed: () => false,
} as unknown as import('monaco-editor').editor.ITextModel;
const position = { lineNumber: 3, column: 7 } as import('monaco-editor').Position;
function setup() {
  const resolveTarget = vi.fn(async (_root, uri: string) =>
    uri.startsWith('file:///project/') ? asRelativePath('helper.go') : null
  );
  window.lingua = { ...original, lsp: { ...original?.lsp, resolveTarget } } as typeof window.lingua;
  const service = {
    openDocument: vi.fn(),
    provideDefinition: vi.fn(async () => [
      { uri: 'file:///project/helper.go', range },
      { uri: 'file:///outside/private.go', range },
    ]),
    provideReferences: vi.fn(async () => [{ uri: 'file:///project/helper.go', range }]),
  } as unknown as LspLanguageIntelligenceAdapter;
  return {
    service,
    resolveTarget,
    providers: createLspNavigationProviders(
      monaco,
      'go',
      () => true,
      () => service
    ),
  };
}
beforeEach(() => {
  version = 1;
  token.isCancellationRequested = false;
  useProjectStore.setState({
    currentProject: { rootId, rootPath: '/project', name: 'project' },
  } as Parameters<typeof useProjectStore.setState>[0]);
  useEditorStore.setState({
    tabs: [
      {
        id: 'main',
        name: 'main.go',
        language: 'go',
        content: 'dirty main',
        isDirty: true,
        filePath: '/project/main.go',
        rootId,
        relativePath: asRelativePath('main.go'),
      },
      {
        id: 'helper',
        name: 'helper.go',
        language: 'go',
        content: 'dirty helper',
        isDirty: true,
        filePath: '/project/helper.go',
        rootId,
        relativePath: asRelativePath('helper.go'),
      },
    ],
    activeTabId: 'main',
  });
});
afterEach(() => {
  window.lingua = original;
  useProjectStore.setState({ currentProject: null });
  useEditorStore.setState({ tabs: [], activeTabId: null });
});
describe('authorized project LSP providers', () => {
  it('flushes all dirty buffers and drops unauthorized destinations before Monaco sees them', async () => {
    const { service, providers, resolveTarget } = setup();
    const result = await providers.definition.provideDefinition(model, position, token);
    expect(service.openDocument).toHaveBeenCalledWith(
      'file:///project/main.go',
      'current dirty source'
    );
    expect(service.openDocument).toHaveBeenCalledWith('file:///project/helper.go', 'dirty helper');
    expect(resolveTarget).toHaveBeenCalledWith(rootId, 'file:///outside/private.go');
    expect(result).toHaveLength(1);
    expect(result[0]?.uri.toString()).toBe('file:///project/helper.go');
    expect(result[0]?.range).toEqual({
      startLineNumber: 3,
      startColumn: 4,
      endLineNumber: 3,
      endColumn: 10,
    });
  });
  it('preserves includeDeclaration for references', async () => {
    const { service, providers } = setup();
    await providers.references.provideReferences(
      model,
      position,
      { includeDeclaration: false },
      token
    );
    expect(service.provideReferences).toHaveBeenCalledWith('file:///project/main.go', 3, 7, false);
  });
  it.each(['cancel', 'root', 'version', 'dirty-target', 'tab'] as const)(
    'rejects response after %s changes',
    async mode => {
      const { service, providers } = setup();
      let resolve!: (value: readonly { uri: string; range: typeof range }[]) => void;
      vi.mocked(service.provideDefinition!).mockImplementation(
        () =>
          new Promise(r => {
            resolve = r;
          })
      );
      const pending = providers.definition.provideDefinition(model, position, token);
      if (mode === 'cancel') token.isCancellationRequested = true;
      if (mode === 'root') useProjectStore.setState({ currentProject: null });
      if (mode === 'version') version++;
      if (mode === 'tab') useEditorStore.setState({ activeTabId: 'helper' });
      if (mode === 'dirty-target')
        useEditorStore.getState().updateContent('helper', 'newer dirty helper');
      resolve([{ uri: 'file:///project/helper.go', range }]);
      expect(await pending).toEqual([]);
    }
  );
  it('does not request navigation for an unbound file', async () => {
    const { service, providers } = setup();
    useEditorStore.setState({
      tabs: useEditorStore.getState().tabs.map(tab => ({ ...tab, rootId: undefined })),
    });
    expect(await providers.definition.provideDefinition(model, position, token)).toEqual([]);
    expect(service.provideDefinition).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import type { LspLanguageIntelligenceAdapter } from '../../../src/renderer/languageIntelligence/types';
import { createLspNavigationProviders } from '../../../src/renderer/components/Editor/completionProviders/lspNavigationProvider';
import {
  MAX_LSP_PREVIEW_MODELS,
  resetLspPreviewModelsForTests,
} from '../../../src/renderer/components/Editor/completionProviders/lspPreviewModels';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { asRootId, asRelativePath } from '../../../src/shared/fs/brandedIds';
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js';

const range = { start: { line: 2, character: 3 }, end: { line: 2, character: 9 } };
const original = window.lingua;
const rootId = asRootId('approved-project');
const models = new Map<string, { uri: { toString(): string }; text: string; disposed: boolean }>();
const monaco = {
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  editor: {
    getModel: (uri: { toString(): string }) => models.get(uri.toString()) ?? null,
    createModel: vi.fn((text: string, _language: string, uri: { toString(): string }) => {
      const created = {
        uri,
        text,
        disposed: false,
        isDisposed: () => created.disposed,
        dispose: () => {
          created.disposed = true;
          models.delete(uri.toString());
        },
      };
      models.set(uri.toString(), created);
      return created;
    }),
  },
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
  const read = vi.fn(async (_root: unknown, relativePath: string) => `disk ${relativePath}`);
  window.lingua = {
    ...original,
    fs: { ...original?.fs, read },
    lsp: { ...original?.lsp, resolveTarget },
  } as typeof window.lingua;
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
    read,
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
  resetLspPreviewModelsForTests();
  models.clear();
  vi.mocked(monaco.editor.createModel).mockClear();
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
  it('identifies project buffers by the Monaco model URI for paths it percent-encodes', async () => {
    const { service, providers } = setup();
    const root = '/work/proj(1)@v+2';
    useProjectStore.setState({
      currentProject: { rootId, rootPath: root, name: 'project' },
    } as Parameters<typeof useProjectStore.setState>[0]);
    useEditorStore.setState({
      tabs: useEditorStore
        .getState()
        .tabs.map(tab => ({ ...tab, filePath: `${root}/${tab.relativePath}` })),
    });
    const modelUri = URI.file(`${root}/main.go`).toString();
    const encodedModel = { ...model, uri: { toString: () => modelUri } } as typeof model;
    await providers.definition.provideDefinition(encodedModel, position, token);
    expect(service.provideDefinition).toHaveBeenCalledWith(modelUri, 3, 7);
    expect(service.openDocument).toHaveBeenCalledWith(
      URI.file(`${root}/helper.go`).toString(),
      'dirty helper'
    );
  });
  it('does not request navigation for an unbound file', async () => {
    const { service, providers } = setup();
    useEditorStore.setState({
      tabs: useEditorStore.getState().tabs.map(tab => ({ ...tab, rootId: undefined })),
    });
    expect(await providers.definition.provideDefinition(model, position, token)).toEqual([]);
    expect(service.provideDefinition).not.toHaveBeenCalled();
  });
});

describe('LSP preview models for unopened destinations', () => {
  function referencesTo(...paths: string[]) {
    const ctx = setup();
    ctx.resolveTarget.mockImplementation(async (_root, uri: string) =>
      asRelativePath(uri.replace('file:///project/', ''))
    );
    vi.mocked(ctx.service.provideReferences!).mockResolvedValue(
      paths.map(path => ({ uri: `file:///project/${path}`, range }))
    );
    return ctx;
  }
  const references = (ctx: ReturnType<typeof setup>) =>
    ctx.providers.references.provideReferences(model, position, { includeDeclaration: true }, token);

  it('creates a model from disk for an authorized file no tab has opened', async () => {
    const ctx = referencesTo('other.go');
    const result = await references(ctx);
    expect(result.map(location => location.uri.toString())).toEqual(['file:///project/other.go']);
    expect(ctx.read).toHaveBeenCalledWith(rootId, 'other.go');
    expect(models.get('file:///project/other.go')?.text).toBe('disk other.go');
    expect(monaco.editor.createModel).toHaveBeenCalledWith(
      'disk other.go',
      'go',
      expect.objectContaining({})
    );
  });

  it('seeds an open buffer from its tab content and leaves existing models alone', async () => {
    models.set('file:///project/main.go', { uri: model.uri, text: 'mounted', disposed: false });
    const ctx = referencesTo('helper.go', 'main.go');
    await references(ctx);
    expect(ctx.read).not.toHaveBeenCalled();
    expect(models.get('file:///project/helper.go')?.text).toBe('dirty helper');
    expect(models.get('file:///project/main.go')?.text).toBe('mounted');
  });

  it('drops the response and creates nothing when context changes during the read', async () => {
    const ctx = referencesTo('other.go');
    ctx.read.mockImplementation(async () => {
      version++;
      return 'late';
    });
    expect(await references(ctx)).toEqual([]);
    expect(models.has('file:///project/other.go')).toBe(false);
  });

  it('disposes the preview before a real tab for that file becomes active', async () => {
    const ctx = referencesTo('other.go');
    await references(ctx);
    const preview = models.get('file:///project/other.go')!;
    useEditorStore.setState(state => ({
      tabs: [
        ...state.tabs,
        {
          id: 'other',
          name: 'other.go',
          language: 'go',
          content: 'fresh from disk',
          isDirty: false,
          filePath: '/project/other.go',
          rootId,
          relativePath: asRelativePath('other.go'),
        },
      ],
      activeTabId: 'other',
    }));
    expect(preview.disposed).toBe(true);
    expect(models.has('file:///project/other.go')).toBe(false);
  });

  it('disposes previews when the project changes and bounds how many stay alive', async () => {
    const paths = Array.from({ length: MAX_LSP_PREVIEW_MODELS + 5 }, (_, i) => `f${i}.go`);
    await references(referencesTo(...paths.slice(0, 5)));
    await references(referencesTo(...paths.slice(5)));
    expect(models.size).toBe(MAX_LSP_PREVIEW_MODELS);
    expect(models.has('file:///project/f0.go')).toBe(false);
    useProjectStore.setState({ currentProject: null });
    expect(models.size).toBe(0);
  });
});

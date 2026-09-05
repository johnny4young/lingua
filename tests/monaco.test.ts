import { beforeEach, describe, expect, it, vi } from 'vitest';

const loaderConfig = vi.fn();
const jsSetCompilerOptions = vi.fn();
const jsSetDiagnosticsOptions = vi.fn();
const jsSetEagerModelSync = vi.fn();
const jsAddExtraLib = vi.fn();
const registerCompletionItemProvider = vi.fn();
const registerHoverProvider = vi.fn();
const registerSignatureHelpProvider = vi.fn();
const tsSetCompilerOptions = vi.fn();
const tsSetDiagnosticsOptions = vi.fn();
const tsSetEagerModelSync = vi.fn();
const tsAddExtraLib = vi.fn();
const getJavaScriptWorker = vi.fn();
const getTypeScriptWorker = vi.fn();

class MockEditorWorker {}
class MockJsonWorker {}
class MockCssWorker {}
class MockHtmlWorker {}
class MockTsWorker {}

const basicLanguageModule = {
  conf: {},
  language: { tokenizer: {} },
};

const monacoMock = {
  editor: {},
  languages: {
    CompletionItemKind: {
      Class: 6,
      Function: 1,
      Keyword: 17,
      Module: 9,
      Snippet: 27,
      Variable: 4,
    },
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
    getLanguages: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
    registerCompletionItemProvider,
    registerHoverProvider,
    registerSignatureHelpProvider,
    typescript: {
      javascriptDefaults: {
        addExtraLib: jsAddExtraLib,
        setCompilerOptions: jsSetCompilerOptions,
        setDiagnosticsOptions: jsSetDiagnosticsOptions,
        setEagerModelSync: jsSetEagerModelSync,
      },
      typescriptDefaults: {
        addExtraLib: tsAddExtraLib,
        setCompilerOptions: tsSetCompilerOptions,
        setDiagnosticsOptions: tsSetDiagnosticsOptions,
        setEagerModelSync: tsSetEagerModelSync,
      },
      ModuleDetectionKind: {
        Force: 3,
      },
      ModuleKind: {
        ESNext: 99,
      },
      ModuleResolutionKind: {
        NodeJs: 2,
      },
      ScriptTarget: {
        ES2022: 9,
      },
    },
  },
};

vi.mock('@monaco-editor/react', () => ({
  loader: {
    config: loaderConfig,
  },
}));

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => monacoMock);
vi.mock('monaco-editor/esm/vs/editor/editor.all.js', () => ({}));
vi.mock('monaco-editor/esm/vs/language/typescript/monaco.contribution.js', () => ({
  getJavaScriptWorker,
  getTypeScriptWorker,
}));
vi.mock('monaco-editor/esm/vs/language/json/monaco.contribution.js', () => ({}));
vi.mock('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js', () => ({}));
vi.mock('monaco-editor/esm/vs/basic-languages/javascript/javascript.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/typescript/typescript.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/go/go.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/python/python.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/rust/rust.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/lua/lua.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/ruby/ruby.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/yaml/yaml.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/shell/shell.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/ini/ini.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
  default: MockEditorWorker,
}));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({
  default: MockJsonWorker,
}));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({
  default: MockCssWorker,
}));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({
  default: MockHtmlWorker,
}));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({
  default: MockTsWorker,
}));

describe('configureMonaco', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete globalThis.MonacoEnvironment;
  });

  it('configures loader and worker environment without applying TS defaults', async () => {
    const { configureMonaco } = await import('@/monaco');

    configureMonaco();

    expect(loaderConfig).toHaveBeenCalledOnce();
    // TS defaults are NOT applied by configureMonaco — they require a fully-initialized
    // monaco instance and are applied via applyTypeScriptDefaults(m) in beforeMount.
    expect(jsSetEagerModelSync).not.toHaveBeenCalled();
    expect(tsSetEagerModelSync).not.toHaveBeenCalled();
    expect(jsSetCompilerOptions).not.toHaveBeenCalled();
    expect(tsSetCompilerOptions).not.toHaveBeenCalled();

    expect(globalThis.MonacoEnvironment.getWorker('worker', 'json')).toBeInstanceOf(MockJsonWorker);
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'typescript')).toBeInstanceOf(
      MockTsWorker
    );
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'unknown')).toBeInstanceOf(
      MockEditorWorker
    );
  });

  it('reuses the configured worker mapping when called multiple times', async () => {
    const { configureMonaco } = await import('@/monaco');

    configureMonaco();
    configureMonaco();

    expect(loaderConfig).toHaveBeenCalledOnce();

    expect(globalThis.MonacoEnvironment.getWorker('worker', 'json')).toBeInstanceOf(MockJsonWorker);
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'typescript')).toBeInstanceOf(
      MockTsWorker
    );
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'unknown')).toBeInstanceOf(
      MockEditorWorker
    );
  });
});

describe('applyTypeScriptDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('applies worker-runtime JS and TS compiler defaults to the given Monaco instance', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');

    // Desktop shape: the Node runtime bridge is present, so the typings load
    // on idle right after the first editor mount.
    (window as unknown as { lingua?: unknown }).lingua = { node: {} };
    try {
      applyTypeScriptDefaults(monacoMock as never);
    } finally {
      delete (window as unknown as { lingua?: unknown }).lingua;
    }

    expect(jsSetEagerModelSync).toHaveBeenCalledWith(true);
    expect(tsSetEagerModelSync).toHaveBeenCalledWith(true);
    expect(jsSetDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      onlyVisible: false,
    });
    expect(tsSetDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      onlyVisible: false,
    });
    expect(jsSetCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        checkJs: true,
        lib: ['es2022', 'webworker'],
        module: 99,
        moduleDetection: 3,
        moduleResolution: 2,
        noEmit: true,
        strict: true,
        target: 9,
      })
    );
    expect(tsSetCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        checkJs: true,
        lib: ['es2022', 'webworker'],
        module: 99,
        moduleDetection: 3,
        moduleResolution: 2,
        noEmit: true,
        strict: true,
        target: 9,
      })
    );
    // The Node typings arrive through one dynamic import scheduled on idle,
    // so addExtraLib fires after that chunk resolves — await it rather than
    // asserting synchronously.
    await vi.waitFor(
      () => {
        expect(jsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining('declare module "crypto"'),
          'file:///node_modules/@types/node/crypto.d.ts'
        );
        expect(tsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining('declare module "crypto"'),
          'file:///node_modules/@types/node/crypto.d.ts'
        );
        expect(jsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining('reference path="crypto.d.ts"'),
          'file:///node_modules/@types/node/index.d.ts'
        );
        expect(tsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining('reference path="crypto.d.ts"'),
          'file:///node_modules/@types/node/index.d.ts'
        );
        expect(jsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining("export * from './fetch'"),
          'file:///node_modules/undici-types/index.d.ts'
        );
        expect(tsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining("export * from './fetch'"),
          'file:///node_modules/undici-types/index.d.ts'
        );
      },
      { timeout: 20_000 }
    );
  }, 25_000);
});

describe('Node typings on the web build', () => {
  type FakeModel = {
    getLanguageId: () => string;
    getValue: () => string;
    getValueLength: () => number;
    onDidChangeContent: (listener: () => void) => { dispose: () => void };
    setValue: (next: string) => void;
  };

  function fakeModel(languageId: string, initial: string): FakeModel {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      getLanguageId: () => languageId,
      getValue: () => value,
      getValueLength: () => value.length,
      onDidChangeContent: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      setValue: (next) => {
        value = next;
        for (const listener of listeners) listener();
      },
    };
  }

  function fakeEditorNamespace(models: FakeModel[]) {
    const created = new Set<(model: FakeModel) => void>();
    return {
      namespace: {
        getModels: () => models,
        onDidCreateModel: (listener: (model: FakeModel) => void) => {
          created.add(listener);
          return { dispose: () => created.delete(listener) };
        },
      },
      create: (model: FakeModel) => {
        models.push(model);
        for (const listener of created) listener(model);
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete (window as unknown as { lingua?: unknown }).lingua;
  });

  it('does not download the typings while no buffer refers to Node', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const editor = fakeEditorNamespace([fakeModel('javascript', 'const x = [1, 2].map(n => n * 2);')]);

    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(jsAddExtraLib).not.toHaveBeenCalled();
    expect(tsAddExtraLib).not.toHaveBeenCalled();
  });

  it('downloads the typings once a JS buffer starts referring to Node', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const model = fakeModel('javascript', 'const x = 1;');
    const editor = fakeEditorNamespace([model]);

    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    expect(jsAddExtraLib).not.toHaveBeenCalled();

    model.setValue("const fs = require('fs');");
    await vi.waitFor(
      () => {
        expect(jsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining('declare module "fs"'),
          'file:///node_modules/@types/node/fs.d.ts'
        );
      },
      { timeout: 20_000 }
    );
  }, 25_000);

  it('ignores Node references in non-JS buffers and picks up later JS models', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const editor = fakeEditorNamespace([fakeModel('python', 'import os\nprocess.env')]);

    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(jsAddExtraLib).not.toHaveBeenCalled();

    editor.create(fakeModel('typescript', "import { readFile } from 'node:fs';"));
    await vi.waitFor(
      () => {
        expect(tsAddExtraLib).toHaveBeenCalledWith(
          expect.stringContaining('declare module "fs"'),
          'file:///node_modules/@types/node/fs.d.ts'
        );
      },
      { timeout: 20_000 }
    );
  }, 25_000);
});

describe('registerLanguageOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers a single language tokenizer plus its editor providers on demand', async () => {
    const { registerLanguageOnce } = await import('@/monaco');

    await registerLanguageOnce(monacoMock as never, 'go');

    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'go' })
    );
    expect(monacoMock.languages.setMonarchTokensProvider).toHaveBeenCalledWith(
      'go',
      expect.anything()
    );
    expect(registerCompletionItemProvider).toHaveBeenCalledWith('go', expect.any(Object));
    expect(registerHoverProvider).toHaveBeenCalledWith('go', expect.any(Object));
    expect(registerSignatureHelpProvider).toHaveBeenCalledWith('go', expect.any(Object));
  });

  it('does not register any other language when one language is requested', async () => {
    const { registerLanguageOnce } = await import('@/monaco');

    // JavaScript is the scratchpad happy path: its TypeScript language service
    // remains built in, while Lingua adds only its magic-comment providers.
    await registerLanguageOnce(monacoMock as never, 'javascript');

    expect(monacoMock.languages.register).toHaveBeenCalledTimes(1);
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'javascript' })
    );
    expect(registerCompletionItemProvider).toHaveBeenCalledTimes(1);
    expect(registerCompletionItemProvider).toHaveBeenCalledWith('javascript', expect.any(Object));
    expect(registerHoverProvider).toHaveBeenCalledWith('javascript', expect.any(Object));
    // No Go / Python / Rust contributions leaked in from the eager old path.
    for (const leaked of ['go', 'python', 'rust', 'ruby', 'lua']) {
      expect(monacoMock.languages.register).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: leaked })
      );
    }
  });

  it('dedupes parallel and repeated calls for the same language', async () => {
    const { registerLanguageOnce } = await import('@/monaco');

    await Promise.all([
      registerLanguageOnce(monacoMock as never, 'rust'),
      registerLanguageOnce(monacoMock as never, 'rust'),
    ]);
    await registerLanguageOnce(monacoMock as never, 'rust');

    const rustRegisterCalls = monacoMock.languages.register.mock.calls.filter(
      ([contribution]: [{ id: string }]) => contribution.id === 'rust'
    );
    const rustCompletionCalls = registerCompletionItemProvider.mock.calls.filter(
      ([languageId]: [string]) => languageId === 'rust'
    );
    expect(rustRegisterCalls).toHaveLength(1);
    expect(rustCompletionCalls).toHaveLength(1);
  });

  it('resolves to a no-op for an unknown language id', async () => {
    const { registerLanguageOnce } = await import('@/monaco');

    await registerLanguageOnce(monacoMock as never, 'definitely-not-a-language');

    expect(monacoMock.languages.register).not.toHaveBeenCalled();
    expect(registerCompletionItemProvider).not.toHaveBeenCalled();
  });
});

describe('prefetchLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('warms a language contribution through the monaco singleton at idle', async () => {
    const idle = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', idle);

    const monacoModule = await import('@/monaco');
    monacoModule.prefetchLanguage('python');
    // Awaiting the same id returns the deduped promise the prefetch started,
    // so the dynamic provider import has fully settled before we assert.
    await monacoModule.registerLanguageOnce(monacoMock as never, 'python');

    vi.unstubAllGlobals();

    expect(idle).toHaveBeenCalledOnce();
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'python' })
    );
    expect(registerCompletionItemProvider).toHaveBeenCalledWith('python', expect.any(Object));
    expect(
      registerCompletionItemProvider.mock.calls.filter(
        ([languageId]: [string]) => languageId === 'python'
      )
    ).toHaveLength(2);
    expect(
      registerHoverProvider.mock.calls.filter(([languageId]: [string]) => languageId === 'python')
    ).toHaveLength(2);
  });
});

describe('loadNavigationTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    ['javascript', getJavaScriptWorker],
    ['typescript', getTypeScriptWorker],
  ])('loads %s symbols through the contribution worker export', async (languageId, getWorker) => {
    const uri = {
      toString: () => `inmemory://model/${languageId}`,
    };
    const navigationTree = {
      text: '<global>',
      kind: 'script',
      spans: [{ start: 0, length: 0 }],
      childItems: [
        {
          text: 'quickSort',
          kind: 'function',
          spans: [{ start: 0, length: 9 }],
          childItems: [],
        },
      ],
    };
    const getNavigationTree = vi.fn().mockResolvedValue(navigationTree);
    const workerFactory = vi.fn().mockResolvedValue({ getNavigationTree });
    getWorker.mockResolvedValue(workerFactory);
    const { loadNavigationTree } = await import('@/monaco');

    await expect(
      loadNavigationTree({
        uri: uri as never,
        getLanguageId: () => languageId,
      })
    ).resolves.toEqual(navigationTree);

    expect(getWorker).toHaveBeenCalledOnce();
    expect(workerFactory).toHaveBeenCalledWith(uri);
    expect(getNavigationTree).toHaveBeenCalledWith(uri.toString());
  });

  it('does not start a TypeScript worker for unsupported languages', async () => {
    const { loadNavigationTree } = await import('@/monaco');

    await expect(
      loadNavigationTree({
        uri: { toString: () => 'inmemory://model/python' } as never,
        getLanguageId: () => 'python',
      })
    ).resolves.toBeNull();

    expect(getJavaScriptWorker).not.toHaveBeenCalled();
    expect(getTypeScriptWorker).not.toHaveBeenCalled();
  });
});

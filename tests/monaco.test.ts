import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loaderConfig = vi.fn();
const jsSetCompilerOptions = vi.fn();
const jsSetEagerModelSync = vi.fn();
const linguaAddExtraLib = vi.fn();
// Node typings load on demand, while the lingua global registers at once, so these track them apart.
function routeExtraLib(nodeLib: ReturnType<typeof vi.fn>) {
  return function (this: unknown, content: string, filePath?: string) {
    return (filePath?.includes('lingua-worker') ? linguaAddExtraLib : nodeLib).call(this, content, filePath);
  };
}
const jsAddExtraLib = vi.fn();
const registerCompletionItemProvider = vi.fn();
const registerHoverProvider = vi.fn();
const registerSignatureHelpProvider = vi.fn();
const registerDefinitionProvider = vi.fn();
const registerReferenceProvider = vi.fn();
const tsSetCompilerOptions = vi.fn();
const tsSetEagerModelSync = vi.fn();
const tsAddExtraLib = vi.fn();
const getJavaScriptWorker = vi.fn();
const getTypeScriptWorker = vi.fn();

// Monaco 0.55.1's own diagnostics defaults per language.
const MONACO_DIAGNOSTICS = {
  javascript: { noSemanticValidation: true, noSyntaxValidation: false, onlyVisible: false },
  typescript: { noSemanticValidation: false, noSyntaxValidation: false, onlyVisible: false },
};
type DiagnosticsOptions = (typeof MONACO_DIAGNOSTICS)['javascript'];
const diagnostics = { ...MONACO_DIAGNOSTICS };
const jsSetDiagnosticsOptions = vi.fn((options: DiagnosticsOptions) => {
  diagnostics.javascript = options;
});
const tsSetDiagnosticsOptions = vi.fn((options: DiagnosticsOptions) => {
  diagnostics.typescript = options;
});

// The TypeScript contribution module, the only place Monaco 0.55 exposes these defaults.
const typeScriptContribution = {
  javascriptDefaults: {
    addExtraLib: routeExtraLib(jsAddExtraLib),
    getDiagnosticsOptions: () => diagnostics.javascript,
    setCompilerOptions: jsSetCompilerOptions,
    setDiagnosticsOptions: jsSetDiagnosticsOptions,
    setEagerModelSync: jsSetEagerModelSync,
  },
  typescriptDefaults: {
    addExtraLib: routeExtraLib(tsAddExtraLib),
    getDiagnosticsOptions: () => diagnostics.typescript,
    setCompilerOptions: tsSetCompilerOptions,
    setDiagnosticsOptions: tsSetDiagnosticsOptions,
    setEagerModelSync: tsSetEagerModelSync,
  },
  // Monaco 0.55.1's enum values.
  ModuleKind: { ESNext: 99 },
  ModuleResolutionKind: { NodeJs: 2 },
  ScriptTarget: { ESNext: 99 },
  getJavaScriptWorker,
  getTypeScriptWorker,
};

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
    registerDefinitionProvider,
    registerReferenceProvider,
  },
};

vi.mock('@monaco-editor/react', () => ({
  loader: {
    config: loaderConfig,
  },
}));

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => monacoMock);
vi.mock('monaco-editor/esm/vs/editor/editor.all.js', () => ({}));
vi.mock(
  'monaco-editor/esm/vs/language/typescript/monaco.contribution.js',
  () => typeScriptContribution
);
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

  it('sets module compiler options once and loads the Node typings on idle on desktop', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');

    // Desktop shape: the Node runtime bridge is present, so the typings load
    // on idle right after the first editor mount.
    (window as unknown as { lingua?: unknown }).lingua = { node: {} };
    try {
      applyTypeScriptDefaults(monacoMock as never);
      applyTypeScriptDefaults(monacoMock as never);
    } finally {
      delete (window as unknown as { lingua?: unknown }).lingua;
    }

    const compilerOptions = {
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      module: 99,
      moduleDetection: 3,
      moduleResolution: 2,
      noEmit: true,
      target: 99,
    };
    // Each call restarts the TypeScript worker, so repeated mounts must not repeat it.
    expect(jsSetCompilerOptions).toHaveBeenCalledOnce();
    expect(jsSetCompilerOptions).toHaveBeenCalledWith({ ...compilerOptions, allowJs: true });
    expect(tsSetCompilerOptions).toHaveBeenCalledOnce();
    expect(tsSetCompilerOptions).toHaveBeenCalledWith(compilerOptions);
    expect(jsSetDiagnosticsOptions).not.toHaveBeenCalled();
    expect(tsSetDiagnosticsOptions).not.toHaveBeenCalled();
    expect(jsSetEagerModelSync).not.toHaveBeenCalled();
    expect(tsSetEagerModelSync).not.toHaveBeenCalled();
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
    dispose: () => void;
    listeners: Set<() => void>;
    disposing: Set<() => void>;
    onWillDispose: (listener: () => void) => { dispose: () => void };
    setLanguage: (next: string) => void;
  };

  function fakeModel(languageId: string, initial: string): FakeModel {
    let value = initial;
    const listeners = new Set<() => void>();
    const disposing = new Set<() => void>();
    return {
      listeners,
      disposing,
      setLanguage: next => {
        languageId = next;
      },
      dispose: () => {
        for (const listener of [...disposing]) listener();
      },
      onWillDispose: listener => {
        disposing.add(listener);
        return { dispose: () => disposing.delete(listener) };
      },
      getLanguageId: () => languageId,
      getValue: vi.fn(() => value),
      getValueLength: () => value.length,
      onDidChangeContent: listener => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      setValue: next => {
        value = next;
        for (const listener of listeners) listener();
      },
    };
  }

  function fakeEditorNamespace(models: FakeModel[]) {
    const created = new Set<(model: FakeModel) => void>();
    const changed = new Set<(event: { model: FakeModel }) => void>();
    return {
      created,
      changed,
      changeLanguage: (model: FakeModel, language: string) => {
        model.setLanguage(language);
        for (const listener of changed) listener({ model });
      },
      namespace: {
        onDidChangeModelLanguage: (listener: (event: { model: FakeModel }) => void) => {
          changed.add(listener);
          return { dispose: () => changed.delete(listener) };
        },
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

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../src/renderer/monacoNodeTypes');
  });

  it.each([
    "import 'node:fs';",
    "await import('node:fs');",
    "import { readFile } from 'fs/promises';",
    "import assert from 'assert';",
    "require ('fs');",
    "import 'node:test';",
    "import { strict } from 'assert/strict';",
  ])('loads typings for %s', async source => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const editor = fakeEditorNamespace([fakeModel('typescript', source)]);
    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await vi.waitFor(() => expect(tsAddExtraLib).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('declares the lingua global for JavaScript and TypeScript without loading Node typings', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    linguaAddExtraLib.mockClear();
    applyTypeScriptDefaults(monacoMock as never);
    expect(linguaAddExtraLib).toHaveBeenCalledTimes(2);
    expect(linguaAddExtraLib.mock.calls[0]![0]).toContain('display: LinguaDisplay');
    // Mirrors DISPLAY_AS in shared/richDisplay.ts.
    expect(linguaAddExtraLib.mock.calls[0]![0]).toContain("as?: 'table' | 'json' | 'image' | 'html' | 'text' | 'chart'");
    expect(tsAddExtraLib).not.toHaveBeenCalled();
  });

  it('shares one observer set across repeated editor mounts', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const model = fakeModel('javascript', '1 + 1');
    const editor = fakeEditorNamespace([model]);
    for (let i = 0; i < 10; i++)
      applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    expect(editor.created.size).toBe(1);
    expect(model.listeners.size).toBe(1);
    expect(model.disposing.size).toBe(1);
  });

  it('clears disposal listeners and queued scans when a model closes', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    vi.useFakeTimers();
    const model = fakeModel('javascript', '1 + 1');
    const editor = fakeEditorNamespace([model]);
    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    model.setValue('process.env');
    model.dispose();
    const reads = vi.mocked(model.getValue).mock.calls.length;
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(model.getValue).mock.calls.length).toBe(reads);
    expect(model.listeners.size).toBe(0);
    expect(model.disposing.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(tsAddExtraLib).not.toHaveBeenCalled();
  });

  it('cleans global observers after an existing model triggers loading', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const model = fakeModel('javascript', 'Buffer.from("x")');
    const editor = fakeEditorNamespace([model]);
    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await vi.waitFor(() => expect(tsAddExtraLib).toHaveBeenCalled());
    expect(editor.created.size).toBe(0);
    expect(editor.changed.size).toBe(0);
    expect(model.listeners.size).toBe(0);
    expect(model.disposing.size).toBe(0);
    expect(jsAddExtraLib.mock.contexts[0]).toBe(typeScriptContribution.javascriptDefaults);
    expect(tsAddExtraLib.mock.contexts[0]).toBe(typeScriptContribution.typescriptDefaults);
  });

  it('invokes extra-lib registration with the original defaults receivers', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const editor = fakeEditorNamespace([fakeModel('javascript', 'process.env')]);
    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await vi.waitFor(() => expect(tsAddExtraLib).toHaveBeenCalled());
    expect(
      jsAddExtraLib.mock.contexts.every(
        context => context === typeScriptContribution.javascriptDefaults
      )
    ).toBe(true);
    expect(
      tsAddExtraLib.mock.contexts.every(
        context => context === typeScriptContribution.typescriptDefaults
      )
    ).toBe(true);
  });

  it('coalesces desktop idle work across repeated mounts', async () => {
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      idleCallbacks.push(callback);
      return 1;
    });
    (window as unknown as { lingua?: unknown }).lingua = { node: {} };
    try {
      const { applyTypeScriptDefaults } = await import('@/monaco');
      const editor = fakeEditorNamespace([fakeModel('javascript', 'process.env')]);
      for (let i = 0; i < 10; i++)
        applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
      expect(idleCallbacks).toHaveLength(1);
      expect(tsAddExtraLib).not.toHaveBeenCalled();
      idleCallbacks[0]!();
      await vi.waitFor(() => expect(tsAddExtraLib).toHaveBeenCalled());
      expect(editor.created.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      delete (window as unknown as { lingua?: unknown }).lingua;
    }
  });

  it('detects a language switch without requiring a content edit', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const model = fakeModel('plaintext', "import 'node:fs';");
    const editor = fakeEditorNamespace([model]);
    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    editor.changeLanguage(model, 'typescript');
    await vi.waitFor(() => expect(tsAddExtraLib).toHaveBeenCalled());
  });

  it('retries after a failed chunk on a later edit without remounting', async () => {
    const failedLoad = vi.fn(() => {
      throw new Error('offline');
    });
    vi.doMock('../src/renderer/monacoNodeTypes', failedLoad);
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const model = fakeModel('javascript', "require('fs');");
    const editor = fakeEditorNamespace([model]);
    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await vi.waitFor(() => expect(failedLoad).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(tsAddExtraLib).not.toHaveBeenCalled();
    vi.doMock('../src/renderer/monacoNodeTypes', () => ({
      NODE_TYPE_DEFINITIONS: { '../../node_modules/@types/node/fs.d.ts': 'declare module "fs" {}' },
      UNDICI_TYPE_DEFINITIONS: {},
    }));
    model.setValue("require('fs'); // retry");
    await vi.waitFor(() => expect(tsAddExtraLib).toHaveBeenCalled(), { timeout: 1500 });
    expect(editor.created.size).toBe(0);
  });

  it('does not download the typings while no buffer refers to Node', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');
    const editor = fakeEditorNamespace([
      fakeModel('javascript', 'const x = [1, 2].map(n => n * 2);'),
    ]);

    applyTypeScriptDefaults({ ...monacoMock, editor: editor.namespace } as never);
    await new Promise(resolve => setTimeout(resolve, 50));

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
    await new Promise(resolve => setTimeout(resolve, 50));
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

describe('setMonacoInlineLintEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.assign(diagnostics, MONACO_DIAGNOSTICS);
  });

  it.each([
    ['javascript', jsSetDiagnosticsOptions],
    ['typescript', tsSetDiagnosticsOptions],
  ] as const)('silences and restores %s diagnostics on the contribution defaults', async (language, setDiagnosticsOptions) => {
    const { setMonacoInlineLintEnabled } = await import('@/monaco');

    setMonacoInlineLintEnabled(language, false);
    expect(setDiagnosticsOptions).toHaveBeenLastCalledWith({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      onlyVisible: false,
    });

    setMonacoInlineLintEnabled(language, true);
    expect(setDiagnosticsOptions).toHaveBeenLastCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      onlyVisible: false,
    });
  });

  it('leaves unchanged options alone, since each change restarts the TypeScript worker', async () => {
    const { setMonacoInlineLintEnabled } = await import('@/monaco');

    setMonacoInlineLintEnabled('typescript', true);
    expect(tsSetDiagnosticsOptions).not.toHaveBeenCalled();
    // Monaco starts JavaScript without semantic checks; Lingua turns them on once.
    setMonacoInlineLintEnabled('javascript', true);
    setMonacoInlineLintEnabled('javascript', true);
    expect(jsSetDiagnosticsOptions).toHaveBeenCalledOnce();

    setMonacoInlineLintEnabled('typescript', false);
    setMonacoInlineLintEnabled('typescript', false);
    expect(tsSetDiagnosticsOptions).toHaveBeenCalledOnce();
  });
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
    expect(registerDefinitionProvider).toHaveBeenCalledWith('go', expect.any(Object));
    expect(registerReferenceProvider).toHaveBeenCalledWith('go', expect.any(Object));
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

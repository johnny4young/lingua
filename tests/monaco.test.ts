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
vi.mock('monaco-editor/esm/vs/language/typescript/monaco.contribution.js', () => ({}));
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
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'typescript')).toBeInstanceOf(MockTsWorker);
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'unknown')).toBeInstanceOf(MockEditorWorker);
  });

  it('reuses the configured worker mapping when called multiple times', async () => {
    const { configureMonaco } = await import('@/monaco');

    configureMonaco();
    configureMonaco();

    expect(loaderConfig).toHaveBeenCalledOnce();

    expect(globalThis.MonacoEnvironment.getWorker('worker', 'json')).toBeInstanceOf(MockJsonWorker);
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'typescript')).toBeInstanceOf(MockTsWorker);
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'unknown')).toBeInstanceOf(MockEditorWorker);
  });
});

describe('applyTypeScriptDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('applies worker-runtime JS and TS compiler defaults to the given Monaco instance', async () => {
    const { applyTypeScriptDefaults } = await import('@/monaco');

    applyTypeScriptDefaults(monacoMock as never);

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
    // RL review: the Node typings register lazily (eager:false), so
    // addExtraLib fires after the type chunk resolves — await it rather than
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
      },
      { timeout: 20_000 }
    );
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
  });

  it('does not register any other language when one language is requested', async () => {
    const { registerLanguageOnce } = await import('@/monaco');

    // JavaScript is the scratchpad happy path: tokenizer registers, but JS
    // ships no custom editor providers (it relies on the TypeScript worker).
    await registerLanguageOnce(monacoMock as never, 'javascript');

    expect(monacoMock.languages.register).toHaveBeenCalledTimes(1);
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'javascript' })
    );
    expect(registerCompletionItemProvider).not.toHaveBeenCalled();
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
  });
});

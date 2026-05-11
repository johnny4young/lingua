import { beforeEach, describe, expect, it, vi } from 'vitest';

const loaderConfig = vi.fn();
const jsSetCompilerOptions = vi.fn();
const jsSetDiagnosticsOptions = vi.fn();
const jsSetEagerModelSync = vi.fn();
const registerCompletionItemProvider = vi.fn();
const registerHoverProvider = vi.fn();
const registerSignatureHelpProvider = vi.fn();
const tsSetCompilerOptions = vi.fn();
const tsSetDiagnosticsOptions = vi.fn();
const tsSetEagerModelSync = vi.fn();

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
        setCompilerOptions: jsSetCompilerOptions,
        setDiagnosticsOptions: jsSetDiagnosticsOptions,
        setEagerModelSync: jsSetEagerModelSync,
      },
      typescriptDefaults: {
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
vi.mock('monaco-editor/esm/vs/basic-languages/javascript/javascript.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/typescript/typescript.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/go/go.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/python/python.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/rust/rust.js', () => basicLanguageModule);
vi.mock('monaco-editor/esm/vs/basic-languages/lua/lua.js', () => basicLanguageModule);
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
  });
});

describe('registerLanguageCompletionProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers completion providers for Go, Python, Rust, and Lua once', async () => {
    const { registerLanguageCompletionProviders } = await import('@/monaco');

    registerLanguageCompletionProviders(monacoMock as never);
    registerLanguageCompletionProviders(monacoMock as never);

    expect(registerCompletionItemProvider).toHaveBeenCalledTimes(4);
    expect(registerCompletionItemProvider).toHaveBeenNthCalledWith(
      1,
      'go',
      expect.any(Object)
    );
    expect(registerCompletionItemProvider).toHaveBeenNthCalledWith(
      2,
      'python',
      expect.any(Object)
    );
    expect(registerCompletionItemProvider).toHaveBeenNthCalledWith(
      3,
      'rust',
      expect.any(Object)
    );
    expect(registerCompletionItemProvider).toHaveBeenNthCalledWith(
      4,
      'lua',
      expect.any(Object)
    );

    // RL-026 Slice 2 — Python also gets a hover + signature-help provider
    // wired through the same registry guard, so double-registration is
    // suppressed alongside the completion list. RL-026 Slice 3 adds the
    // same pair for Rust (rust-analyzer via the LSP bridge).
    expect(registerHoverProvider).toHaveBeenCalledTimes(2);
    expect(registerHoverProvider).toHaveBeenCalledWith('python', expect.any(Object));
    expect(registerHoverProvider).toHaveBeenCalledWith('rust', expect.any(Object));
    expect(registerSignatureHelpProvider).toHaveBeenCalledTimes(2);
    expect(registerSignatureHelpProvider).toHaveBeenCalledWith('python', expect.any(Object));
    expect(registerSignatureHelpProvider).toHaveBeenCalledWith('rust', expect.any(Object));
  });

  it('registers built-in non-runtime language tokenizers once alongside completion providers', async () => {
    const { registerLanguageCompletionProviders } = await import('@/monaco');

    registerLanguageCompletionProviders(monacoMock as never);

    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'yaml' })
    );
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dotenv' })
    );
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'csv' })
    );
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dockerfile' })
    );
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shell' })
    );
    expect(monacoMock.languages.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'makefile' })
    );
  });
});

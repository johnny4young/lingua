import { beforeEach, describe, expect, it, vi } from 'vitest';

const loaderConfig = vi.fn();
const jsSetCompilerOptions = vi.fn();
const jsSetDiagnosticsOptions = vi.fn();
const jsSetEagerModelSync = vi.fn();
const tsSetCompilerOptions = vi.fn();
const tsSetDiagnosticsOptions = vi.fn();
const tsSetEagerModelSync = vi.fn();

class MockEditorWorker {}
class MockJsonWorker {}
class MockCssWorker {}
class MockHtmlWorker {}
class MockTsWorker {}

const monacoMock = {
  editor: {},
  languages: {
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

  it('configures Monaco once with worker-runtime JS and TS defaults', async () => {
    const { configureMonaco } = await import('@/monaco');

    configureMonaco();

    expect(loaderConfig).toHaveBeenCalledOnce();
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

  it('reuses the configured worker mapping without reapplying defaults', async () => {
    const { configureMonaco } = await import('@/monaco');

    configureMonaco();
    configureMonaco();

    expect(loaderConfig).toHaveBeenCalledOnce();
    expect(jsSetCompilerOptions).toHaveBeenCalledOnce();
    expect(tsSetCompilerOptions).toHaveBeenCalledOnce();

    expect(globalThis.MonacoEnvironment.getWorker('worker', 'json')).toBeInstanceOf(
      MockJsonWorker
    );
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'typescript')).toBeInstanceOf(
      MockTsWorker
    );
    expect(globalThis.MonacoEnvironment.getWorker('worker', 'unknown')).toBeInstanceOf(
      MockEditorWorker
    );
  });
});

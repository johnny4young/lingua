import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

type MonacoWorkerFactory = new () => Worker;

const WORKER_RUNTIME_LIBS = ['es2022', 'webworker'];

const workerFactories: Record<string, MonacoWorkerFactory> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  handlebars: HtmlWorker,
  razor: HtmlWorker,
  javascript: TsWorker,
  typescript: TsWorker,
};

function getWorkerFactory(label: string): MonacoWorkerFactory {
  return workerFactories[label] ?? EditorWorker;
}

let configured = false;

function configureTypeScriptDefaults() {
  const compilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    checkJs: true,
    lib: WORKER_RUNTIME_LIBS,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleDetection: monaco.languages.typescript.ModuleDetectionKind.Force,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    strict: true,
    target: monaco.languages.typescript.ScriptTarget.ES2022,
  };

  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
  };

  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);

  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
}

export function configureMonaco(): void {
  if (configured) return;
  configured = true;

  loader.config({ monaco });
  configureTypeScriptDefaults();

  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      const WorkerFactory = getWorkerFactory(label);
      return new WorkerFactory();
    },
  };
}

import { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

// `editor.api.js` only ships the core API surface. Editor contributions
// (suggest widget, find/replace, bracket matching, folding, etc.) live in
// `editor.all.js` and must be imported separately. Without this import the
// suggest popup physically cannot appear because the SuggestController
// contribution is never registered with the editor.
import 'monaco-editor/esm/vs/editor/editor.all.js';
// JS/TS syntax coloring and language services are registered by Monaco's
// TypeScript contribution, not by the raw editor API surface.
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';

// ── Workers ────────────────────────────────────────────────────────────────
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { createGoCompletionProvider } from './components/Editor/completionProviders/goCompletions';
import { createPythonCompletionProvider } from './components/Editor/completionProviders/pythonCompletions';
import { createRustCompletionProvider } from './components/Editor/completionProviders/rustCompletions';
import { createLuaCompletionProvider } from './components/Editor/completionProviders/luaCompletions';

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
let languageContributionsLoaded = false;
let completionProvidersRegistered = false;

/**
 * Lightweight language definitions registered directly via the Monaco API
 * instead of importing the per-language `*.contribution.js` files (which
 * chain through `_.contribution.js` and re-import the entire editor.all
 * contribution set, causing duplicate registrations and vitest DOM errors).
 */
const LANGUAGE_CONTRIBUTIONS = [
  { id: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], aliases: ['JavaScript', 'javascript'], loader: () => import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js') },
  { id: 'typescript', extensions: ['.ts', '.tsx'], aliases: ['TypeScript', 'typescript'], loader: () => import('monaco-editor/esm/vs/basic-languages/typescript/typescript.js') },
  { id: 'go', extensions: ['.go'], aliases: ['Go'], loader: () => import('monaco-editor/esm/vs/basic-languages/go/go.js') },
  { id: 'python', extensions: ['.py'], aliases: ['Python'], loader: () => import('monaco-editor/esm/vs/basic-languages/python/python.js') },
  { id: 'rust', extensions: ['.rs'], aliases: ['Rust'], loader: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.js') },
  { id: 'lua', extensions: ['.lua'], aliases: ['Lua'], loader: () => import('monaco-editor/esm/vs/basic-languages/lua/lua.js') },
] as const;

const completionProviderFactories = [
  ['go', createGoCompletionProvider],
  ['python', createPythonCompletionProvider],
  ['rust', createRustCompletionProvider],
  ['lua', createLuaCompletionProvider],
] as const;

/**
 * Set up the worker environment and loader. Must be called once before any
 * MonacoEditor component renders. TypeScript language defaults are intentionally
 * NOT configured here because monaco.languages.typescript is only guaranteed to
 * exist after the editor's beforeMount callback fires. Call
 * applyTypeScriptDefaults(monaco) in the beforeMount prop instead.
 */
export function configureMonaco(): void {
  if (configured) return;
  configured = true;

  loader.config({ monaco });

  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      const WorkerFactory = getWorkerFactory(label);
      return new WorkerFactory();
    },
  };
}

/**
 * Register basic language contributions (tokenizer + language config) for
 * Go, Python, Rust, and Lua. Idempotent; safe to call multiple times.
 */
function ensureLanguageContributions(m: Monaco): void {
  if (languageContributionsLoaded) return;
  languageContributionsLoaded = true;

  for (const lang of LANGUAGE_CONTRIBUTIONS) {
    if (!m.languages.getLanguages().some((l: { id: string }) => l.id === lang.id)) {
      m.languages.register({
        id: lang.id,
        extensions: [...lang.extensions],
        aliases: [...lang.aliases],
      });
    }

    void lang.loader().then((mod) => {
      m.languages.setMonarchTokensProvider(lang.id, mod.language);
      m.languages.setLanguageConfiguration(lang.id, mod.conf);
    });
  }
}

/**
 * Configure TypeScript/JavaScript language defaults. Must be called inside a
 * MonacoEditor beforeMount callback where the monaco instance is fully
 * initialised and monaco.languages.typescript is guaranteed to exist.
 */
export function applyTypeScriptDefaults(m: Monaco): void {
  const ts = m.languages.typescript;
  if (!ts) return;

  const compilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    checkJs: true,
    lib: WORKER_RUNTIME_LIBS,
    module: ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };

  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
  };

  ts.javascriptDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  ts.javascriptDefaults.setCompilerOptions(compilerOptions);

  ts.typescriptDefaults.setEagerModelSync(true);
  ts.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
}

export function registerLanguageCompletionProviders(m: Monaco): void {
  ensureLanguageContributions(m);

  if (completionProvidersRegistered) return;
  completionProvidersRegistered = true;

  for (const [languageId, createProvider] of completionProviderFactories) {
    m.languages.registerCompletionItemProvider(languageId, createProvider(m));
  }
}

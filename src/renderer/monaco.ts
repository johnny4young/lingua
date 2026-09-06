import { loader, type Monaco } from '@monaco-editor/react';
import { runWhenIdle } from './utils/runWhenIdle';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

// `editor.api.js` only ships the core API surface. Editor contributions
// (suggest widget, find/replace, bracket matching, folding, etc.) live in
// `editor.all.js` and must be imported separately. Without this import the
// suggest popup physically cannot appear because the SuggestController
// contribution is never registered with the editor.
import 'monaco-editor/esm/vs/editor/editor.all.js';
// JS/TS syntax coloring and language services are registered by Monaco's
// TypeScript contribution, not by the raw editor API surface.
import * as typeScriptContribution from 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
// implementation — the SQL workspace editor renders Monaco on the `sql`
// language. SQL is a basic-language (Monarch tokenizer + language config),
// so its contribution is imported eagerly here alongside JS/TS/JSON. It is
// not routed through the lazy `registerLanguageOnce` registry because the
// SQL workspace is not a file-backed editor tab — there is no
// `LanguageSupportDescriptor` for it.
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';

// ── Workers ────────────────────────────────────────────────────────────────
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { getLanguageSupportDescriptor } from './languageSupport/registry';
import type { NavigationTreeItem } from './utils/symbolNavigation';
import { loadNodeTypeDefinitions } from './nodeTypeDefinitionsLoader';
import { NODE_BUILTINS } from '../shared/dependencies/nodeBuiltins';

type MonacoWorkerFactory = new () => Worker;

const WORKER_RUNTIME_LIBS = ['es2022', 'webworker'];
const NODE_TYPE_DEFINITION_ROOT_MARKER = 'node_modules/@types/node/';
const NODE_TYPE_DEFINITION_ROOT_URI = 'file:///node_modules/@types/node/';
const UNDICI_TYPE_DEFINITION_ROOT_MARKER = 'node_modules/undici-types/';
const UNDICI_TYPE_DEFINITION_ROOT_URI = 'file:///node_modules/undici-types/';
// The Node typings live in `./monacoNodeTypes.ts` behind a dynamic import:
// ~2.4 MB of raw .d.ts that must never reach the initial graph, and that the
// web build only needs when a JS/TS model actually refers to Node. See
// `scheduleNodeTypeDefinitions` for who loads it and when.
const NODE_TYPINGS_LANGUAGES = new Set(['javascript', 'typescript']);
// Cheap signal that a JS/TS buffer is Node code and would benefit from the
// Node typings: CommonJS require, the process/Buffer globals, __dirname,
// or an import of a Node built-in (with or without the node: prefix).
const NODE_GLOBAL_REFERENCE_RE =
  /\b(?:require\s*\(|process\b|Buffer\b|__dirname\b|__filename\b|NodeJS\b|global\b|module\s*\.\s*exports|exports\s*[.[])/u;
const MODULE_REFERENCE_RE = /\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"\r\n]+)['"]/gu;
// Bound per-edit scanning cost; oversized buffers are reconsidered on edits.
const NODE_REFERENCE_SCAN_MAX_CHARS = 200_000;
const NODE_REFERENCE_SCAN_DEBOUNCE_MS = 300;

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
let nodeTypeDefinitionsRegistered = false;
let nodeTypeDefinitionsLoading: Promise<boolean> | null = null;
let nodeTypeDefinitionsScheduled = false;

/**
 * Per-language registration cache, keyed by Monaco language id. The value is the
 * in-flight-or-settled promise for that language's contribution + editor
 * providers. A Map (not a boolean per language) lets parallel callers — the
 * editor mount, a language switch, and an idle prefetch — dedupe onto a single
 * registration instead of racing duplicate `register()` / provider calls.
 */
const languageRegistrations = new Map<string, Promise<void>>();

/**
 * Set up the worker environment and loader. Must be called once before any
 * MonacoEditor component renders. TypeScript language defaults are intentionally
 * NOT configured here; the lazy typing scheduler needs the editor lifecycle. Call
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
 * Returns the configured Monaco singleton for static, non-editor consumers.
 * These callers must not use `useMonaco()`: that hook starts the async editor
 * loader, which is needless for tokenizer-only surfaces such as utility
 * output. The returned API shares theme and language registration with every
 * live Lingua code editor.
 */
export function getConfiguredMonaco(): Monaco {
  configureMonaco();
  return monaco as unknown as Monaco;
}

/**
 * Register one language's Monaco contribution (tokenizer + language config) and
 * its lazily-imported editor providers (completion / hover / signature) exactly
 * once. Returns the shared registration promise so callers can await readiness
 * or fire-and-forget. Unknown language ids resolve to a no-op.
 *
 * Lazy-registration contract: JS/TS are pre-registered by
 * the editor mount for the scratchpad happy path; every other language is
 * registered the first time a tab activates it. Opening a JavaScript scratchpad
 * therefore never pulls the Go / Rust / Python / Ruby / Lua tokenizer or
 * completion-provider chunks — they load on demand when the matching file type
 * is opened. Tokenizer coloring applies as soon as the (already code-split)
 * loader resolves; providers register a tick later, which is invisible because
 * completion / hover / signature help are user-triggered, not first-paint.
 */
export function registerLanguageOnce(m: Monaco, languageId: string): Promise<void> {
  const cached = languageRegistrations.get(languageId);
  if (cached) return cached;
  const registration = registerLanguageContribution(m, languageId).catch(error => {
    // Never cache a poisoned entry: drop it so a later activation can retry,
    // and resolve (not reject) so fire-and-forget callers do not emit an
    // unhandled rejection.
    languageRegistrations.delete(languageId);
    console.warn(`[monaco] language registration failed: ${languageId}`, error);
  });
  languageRegistrations.set(languageId, registration);
  return registration;
}

async function registerLanguageContribution(m: Monaco, languageId: string): Promise<void> {
  const descriptor = getLanguageSupportDescriptor(languageId);
  if (!descriptor) return;

  const lang = descriptor.monaco;
  if (lang) {
    if (!m.languages.getLanguages().some((l: { id: string }) => l.id === lang.id)) {
      m.languages.register({
        id: lang.id,
        extensions: [...lang.extensions],
        aliases: [...lang.aliases],
      });
    }

    if (lang.basicLanguage) {
      try {
        // internal — the monaco basic-language imports live in a module that is
        // ONLY dynamically imported (here), never statically reachable from
        // the app entry, so Monaco core stays out of the web `initial` bundle.
        const { loadBasicLanguage } = await import('./languageSupport/basicLanguageLoaders');
        const mod = await loadBasicLanguage(lang.basicLanguage);
        m.languages.setMonarchTokensProvider(lang.id, mod.language);
        m.languages.setLanguageConfiguration(lang.id, mod.conf);
      } catch {
        // Optional tokenizer chunks must not create unhandled rejections;
        // Monaco keeps the registered language as a plain mode.
      }
    } else {
      m.languages.setMonarchTokensProvider(lang.id, lang.language);
      m.languages.setLanguageConfiguration(lang.id, lang.config);
    }
  }

  if (descriptor.loadEditorProviders) {
    try {
      const providers = await descriptor.loadEditorProviders();
      if (providers.createCompletionProvider) {
        m.languages.registerCompletionItemProvider(
          descriptor.id,
          providers.createCompletionProvider(m)
        );
      }
      for (const createCompletionProvider of providers.createCompletionProviders ?? []) {
        m.languages.registerCompletionItemProvider(descriptor.id, createCompletionProvider(m));
      }
      if (providers.createHoverProvider) {
        m.languages.registerHoverProvider(descriptor.id, providers.createHoverProvider());
      }
      for (const createHoverProvider of providers.createHoverProviders ?? []) {
        m.languages.registerHoverProvider(descriptor.id, createHoverProvider());
      }
      if (providers.createSignatureHelpProvider) {
        m.languages.registerSignatureHelpProvider(
          descriptor.id,
          providers.createSignatureHelpProvider()
        );
      }
    } catch {
      // Editor providers are best-effort; a failed dynamic import leaves the
      // language usable with tokenizer coloring but no language-specific
      // completion / hover / signature help.
    }
  }
}

/**
 * Warm one language's contribution during browser idle time via the Monaco
 * singleton, so the tokenizer + provider chunks are already in flight before
 * the editor component finishes mounting. Safe to call before any editor
 * renders; dedupes through `registerLanguageOnce`. Falls back to a 0ms timeout
 * where `requestIdleCallback` is unavailable (Electron renderer, jsdom).
 */
export function prefetchLanguage(languageId: string): void {
  runWhenIdle(() => {
    // `configureMonaco()` calls loader.config({ monaco }), so @monaco-editor/react
    // and this singleton are the same instance sharing one global language
    // registry — registering against either is equivalent. The cast only bridges
    // the narrower editor.api.js namespace type to the full Monaco type.
    void registerLanguageOnce(monaco as unknown as Monaco, languageId);
  });
}

/**
 * Run `callback` during browser idle time, or on a 0ms timeout where
 * `requestIdleCallback` is unavailable (Electron renderer, jsdom). The timeout
 * guarantees the work still runs under sustained main-thread load.
 */

type MonacoLanguageDefaultsWithExtraLib = {
  addExtraLib?: (content: string, filePath?: string) => unknown;
};

type MonacoTypeScriptDefaultsWithExtraLib = {
  javascriptDefaults: MonacoLanguageDefaultsWithExtraLib;
  typescriptDefaults: MonacoLanguageDefaultsWithExtraLib;
};

function typeDefinitionUri(modulePath: string): string | null {
  for (const { marker, uri } of [
    {
      marker: NODE_TYPE_DEFINITION_ROOT_MARKER,
      uri: NODE_TYPE_DEFINITION_ROOT_URI,
    },
    {
      marker: UNDICI_TYPE_DEFINITION_ROOT_MARKER,
      uri: UNDICI_TYPE_DEFINITION_ROOT_URI,
    },
  ] as const) {
    const markerIndex = modulePath.indexOf(marker);
    if (markerIndex === -1) continue;
    const relativePath = modulePath.slice(markerIndex + marker.length);
    return `${uri}${relativePath}`;
  }

  return null;
}

function registerNodeTypeDefinitions(ts: MonacoTypeScriptDefaultsWithExtraLib): Promise<boolean> {
  if (nodeTypeDefinitionsRegistered) return Promise.resolve(true);
  if (nodeTypeDefinitionsLoading) return nodeTypeDefinitionsLoading;
  if (
    typeof ts.javascriptDefaults.addExtraLib !== 'function' ||
    typeof ts.typescriptDefaults.addExtraLib !== 'function'
  )
    return Promise.resolve(false);

  nodeTypeDefinitionsLoading = (async () => {
    try {
      const definitions = await loadNodeTypeDefinitions();
      const typeDefinitions = {
        ...definitions.NODE_TYPE_DEFINITIONS,
        ...definitions.UNDICI_TYPE_DEFINITIONS,
      };
      // Register in one tick to preserve Monaco's resync debounce. These are
      // receiver-dependent methods, not standalone callbacks.
      for (const [modulePath, content] of Object.entries(typeDefinitions).sort(([left], [right]) =>
        left.localeCompare(right)
      )) {
        const filePath = typeDefinitionUri(modulePath);
        if (!filePath) continue;
        ts.javascriptDefaults.addExtraLib!(content, filePath);
        ts.typescriptDefaults.addExtraLib!(content, filePath);
      }
      nodeTypeDefinitionsRegistered = true;
      return true;
    } catch {
      // Best effort, including registration failures: retain observers so a
      // later edit/model can retry, without an automatic retry loop. Monaco
      // deduplicates identical extra-lib content if a partial pass is retried.
      return false;
    } finally {
      nodeTypeDefinitionsLoading = null;
    }
  })();
  return nodeTypeDefinitionsLoading;
}

type MonacoTextModelLike = {
  getLanguageId: () => string;
  getValue: () => string;
  getValueLength: () => number;
  isDisposed?: () => boolean;
  onDidChangeContent: (listener: () => void) => { dispose: () => void };
  onWillDispose?: (listener: () => void) => { dispose: () => void };
};

type MonacoEditorNamespaceLike = {
  getModels?: () => MonacoTextModelLike[];
  onDidChangeModelLanguage?: (listener: (event: { model: MonacoTextModelLike }) => void) => {
    dispose: () => void;
  };
  onDidCreateModel?: (listener: (model: MonacoTextModelLike) => void) => { dispose: () => void };
};

function hasNodeRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as { lingua?: { node?: unknown } }).lingua?.node)
  );
}

function modelReferencesNode(model: MonacoTextModelLike): boolean {
  if (model.isDisposed?.() || !NODE_TYPINGS_LANGUAGES.has(model.getLanguageId())) return false;
  if (model.getValueLength() > NODE_REFERENCE_SCAN_MAX_CHARS) return false;
  const value = model.getValue();
  if (NODE_GLOBAL_REFERENCE_RE.test(value)) return true;
  for (const match of value.matchAll(MODULE_REFERENCE_RE)) {
    const specifier = match[1]!;
    if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0]!)) return true;
  }
  return false;
}

/**
 * Decide when the Node typings load.
 *
 * Desktop with the Node runtime: on idle after the first editor mount — the
 * user can run Node code there, so `crypto`/`fs` intellisense should be ready
 * by the time they type. Web: Node code cannot run, so the 2.4 MB chunk is
 * only worth its download once a JS/TS buffer actually refers to Node; watch
 * the models and load on the first match, then stop watching.
 */
function scheduleNodeTypeDefinitions(m: Monaco, ts: MonacoTypeScriptDefaultsWithExtraLib): void {
  if (nodeTypeDefinitionsRegistered || nodeTypeDefinitionsScheduled) return;
  const desktop = hasNodeRuntime();
  const editorNamespace = m.editor as unknown as MonacoEditorNamespaceLike;
  if (
    typeof editorNamespace.onDidCreateModel !== 'function' ||
    typeof editorNamespace.getModels !== 'function'
  ) {
    if (desktop) {
      nodeTypeDefinitionsScheduled = true;
      runWhenIdle(() => {
        void registerNodeTypeDefinitions(ts).finally(() => {
          nodeTypeDefinitionsScheduled = false;
        });
      });
    }
    return;
  }

  nodeTypeDefinitionsScheduled = true;
  const models = new Map<MonacoTextModelLike, () => void>();
  const observers: Array<{ dispose: () => void }> = [];
  let loading = false;
  let idlePending = desktop;
  const trigger = async (): Promise<void> => {
    if (loading || nodeTypeDefinitionsRegistered) return;
    loading = true;
    const success = await registerNodeTypeDefinitions(ts);
    loading = false;
    if (!success) return;
    for (const cleanup of models.values()) cleanup();
    for (const observer of observers.splice(0)) observer.dispose();
    nodeTypeDefinitionsScheduled = false;
  };
  const inspect = (model: MonacoTextModelLike): void => {
    if (idlePending || model.isDisposed?.()) return;
    if (modelReferencesNode(model)) void trigger();
  };
  const watch = (model: MonacoTextModelLike): void => {
    if (nodeTypeDefinitionsRegistered || models.has(model) || model.isDisposed?.()) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const subscription = model.onDidChangeContent(() => {
      if (debounce !== null) clearTimeout(debounce);
      debounce = null;
      if (loading || !NODE_TYPINGS_LANGUAGES.has(model.getLanguageId())) return;
      debounce = setTimeout(() => {
        debounce = null;
        if (!disposed) inspect(model);
      }, NODE_REFERENCE_SCAN_DEBOUNCE_MS);
    });
    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      if (debounce !== null) clearTimeout(debounce);
      debounce = null;
      subscription.dispose();
      disposal?.dispose();
      models.delete(model);
    };
    models.set(model, cleanup);
    const disposal = model.onWillDispose?.(cleanup);
    // Desktop's first attempt remains idle-scheduled; after an unsuccessful
    // attempt new models and edits provide the same demand-driven retry path.
    inspect(model);
  };

  // Subscribe before scanning existing models so an immediate match cannot
  // leave a newly-added global observer behind after successful registration.
  observers.push(editorNamespace.onDidCreateModel(watch));
  const languageObserver = editorNamespace.onDidChangeModelLanguage?.(({ model }) => {
    watch(model);
    inspect(model);
  });
  if (languageObserver) observers.push(languageObserver);
  for (const model of editorNamespace.getModels()) watch(model);
  if (desktop)
    runWhenIdle(() => {
      idlePending = false;
      void trigger();
    });
}

/**
 * Configure TypeScript/JavaScript language defaults. Must be called inside a
 * MonacoEditor beforeMount callback where the monaco instance is fully
 * initialised. Modern ESM exposes TypeScript defaults via its contribution
 * module rather than the legacy core namespace.
 */
export function applyTypeScriptDefaults(m: Monaco): void {
  const ts = m.languages.typescript;
  if (!ts) {
    // Monaco 0.55's core API omits the legacy namespace. Typing registration
    // must still run via the ESM contribution. Do not change unrelated
    // compiler/diagnostic defaults while repairing this lazy-load boundary.
    scheduleNodeTypeDefinitions(
      m,
      typeScriptContribution as unknown as MonacoTypeScriptDefaultsWithExtraLib
    );
    return;
  }

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

  // beforeMount is synchronous, so editor creation never waits on the Node
  // typings; `scheduleNodeTypeDefinitions` decides whether they load on idle
  // (desktop) or only once a buffer refers to Node (web).
  scheduleNodeTypeDefinitions(m, ts);
}

/**
 * internal — toggle Monaco's built-in TS/JS live diagnostics for one language.
 * `applyTypeScriptDefaults` enables them by default; this lets the Settings
 * "Inline lint" toggle silence (or restore) the squiggles per language by
 * flipping `noSemanticValidation` / `noSyntaxValidation`. Monaco's TS/JS
 * defaults are global singletons, so this affects every model of that language
 * (the toggle is per-language, not per-tab, by design). No-op when the
 * TypeScript contribution is not yet present.
 */
export function setMonacoInlineLintEnabled(
  m: Monaco,
  language: 'javascript' | 'typescript',
  enabled: boolean
): void {
  const ts = m.languages.typescript;
  if (!ts) return;
  const defaults = language === 'typescript' ? ts.typescriptDefaults : ts.javascriptDefaults;
  defaults.setDiagnosticsOptions({
    noSemanticValidation: !enabled,
    noSyntaxValidation: !enabled,
    onlyVisible: false,
  });
}

// Monaco's direct TypeScript contribution declaration is currently an empty
// stub even though the ESM module exports the worker accessors at runtime.
// Keep the bridge narrow so this implementation does not invent a broader
// Monaco API surface.
interface MonacoTypeScriptContributionRuntime {
  getTypeScriptWorker?: () => Promise<
    (...uris: monaco.Uri[]) => Promise<TypeScriptWorkerClient>
  >;
  getJavaScriptWorker?: () => Promise<
    (...uris: monaco.Uri[]) => Promise<TypeScriptWorkerClient>
  >;
}

interface TypeScriptWorkerClient {
  getNavigationTree: (fileName: string) => Promise<NavigationTreeItem | undefined>;
}

/**
 * Load the declaration tree for a Monaco model through the TypeScript worker.
 * Returns `null` when the model's language is not JS/TS (the caller should
 * render an empty state) or the worker has not been spun up yet.
 *
 * We keep this in `monaco.ts` because it's the single file that already owns
 * the monaco singleton — downstream components would otherwise have to
 * re-import the heavy editor entry just to reach the worker factory.
 */
export async function loadNavigationTree(model: {
  uri: monaco.Uri;
  getLanguageId: () => string;
}): Promise<NavigationTreeItem | null> {
  const languageId = model.getLanguageId();
  // Monaco 0.55 exports these factories from the contribution module; it does
  // not attach them to `monaco.languages.typescript`. The direct ESM
  // declaration is currently an empty stub, so keep this runtime bridge narrow
  // and local until Monaco ships the matching per-module types.
  const runtime = typeScriptContribution as unknown as MonacoTypeScriptContributionRuntime;
  const getWorker =
    languageId === 'typescript'
      ? runtime.getTypeScriptWorker
      : languageId === 'javascript'
        ? runtime.getJavaScriptWorker
        : null;

  if (!getWorker) return null;

  try {
    const workerFactory = await getWorker();
    const client = await workerFactory(model.uri);
    return (await client.getNavigationTree(model.uri.toString())) ?? null;
  } catch {
    // The TS worker intermittently rejects while spinning up on fresh tabs —
    // surface a null so the overlay can degrade to an empty state instead of
    // crashing.
    return null;
  }
}

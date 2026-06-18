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
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
// RL-097 Slice 3 — the SQL workspace editor renders Monaco on the `sql`
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
 * Register one language's Monaco contribution (tokenizer + language config) and
 * its lazily-imported editor providers (completion / hover / signature) exactly
 * once. Returns the shared registration promise so callers can await readiness
 * or fire-and-forget. Unknown language ids resolve to a no-op.
 *
 * Lazy-registration contract (RL-124 / AUDIT-04): JS/TS are pre-registered by
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
  const registration = registerLanguageContribution(m, languageId).catch((error) => {
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

    if (lang.loader) {
      try {
        const mod = await lang.loader();
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
      if (providers.createHoverProvider) {
        m.languages.registerHoverProvider(descriptor.id, providers.createHoverProvider());
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
  const run = (): void => {
    // `configureMonaco()` calls loader.config({ monaco }), so @monaco-editor/react
    // and this singleton are the same instance sharing one global language
    // registry — registering against either is equivalent. The cast only bridges
    // the narrower editor.api.js namespace type to the full Monaco type.
    void registerLanguageOnce(monaco as unknown as Monaco, languageId);
  };
  const idle = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof idle === 'function') {
    // The timeout guarantees the warm-up still runs under sustained main-thread
    // load; CodeEditor's active-language effect is the backstop if it slips.
    idle(run, { timeout: 2000 });
  } else {
    setTimeout(run, 0);
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

/**
 * RL-108 — toggle Monaco's built-in TS/JS live diagnostics for one language.
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

// The TypeScript contribution augments the global `monaco.languages` object
// with worker accessors at runtime, but `editor.api.d.ts` exports only a
// deprecation stub (`{ deprecated: true }`) so the types don't reflect that
// augmentation. This narrow shape is how we reach the real factories.
interface MonacoTypeScriptRuntime {
  getTypeScriptWorker?: () => Promise<(uri: monaco.Uri) => Promise<TypeScriptWorkerClient>>;
  getJavaScriptWorker?: () => Promise<(uri: monaco.Uri) => Promise<TypeScriptWorkerClient>>;
}

interface TypeScriptWorkerClient {
  getNavigationBarItems: (fileName: string) => Promise<unknown[]>;
}

/**
 * Load every navigation-bar entry for a Monaco model through the TypeScript
 * worker. Returns `null` when the model's language is not JS/TS (the caller
 * should render an empty state) or the worker has not been spun up yet.
 *
 * We keep this in `monaco.ts` because it's the single file that already owns
 * the monaco singleton — downstream components would otherwise have to
 * re-import the heavy editor entry just to reach the worker factory.
 */
export async function loadNavigationBarItems(
  model: { uri: monaco.Uri; getLanguageId: () => string }
): Promise<unknown[] | null> {
  const languageId = model.getLanguageId();
  const runtime = monaco.languages.typescript as unknown as MonacoTypeScriptRuntime;
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
    return await client.getNavigationBarItems(model.uri.toString());
  } catch {
    // The TS worker intermittently rejects while spinning up on fresh tabs —
    // surface a null so the overlay can degrade to an empty state instead of
    // crashing.
    return null;
  }
}

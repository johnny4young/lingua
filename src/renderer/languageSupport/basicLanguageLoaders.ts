import type { MonacoBasicLanguageId, MonacoBasicLanguageModule } from './types';

/**
 * SR-01 — the single home for every `import('monaco-editor/esm/vs/basic-languages/…')`.
 *
 * These dynamic imports used to live inline on each language descriptor
 * (`javascript.ts`, `fileTypes.ts`, …). Because those descriptor modules are
 * statically reachable from the app entry (App → monaco.ts → registry.ts →
 * each descriptor), Rolldown placed Vite's `__vitePreload` helper inside the
 * Monaco-core chunk to service those imports, and the entry then statically
 * imported that helper — dragging all of Monaco core into the web `initial`
 * bundle (~3.6 MiB raw / ~987 KB gzip).
 *
 * This module is imported ONLY dynamically, from inside
 * `registerLanguageContribution` in `monaco.ts`, which itself runs lazily on
 * tab activation. Nothing in the eager graph references it, so the basic
 * language imports (and their preload helper) stay in a lazy chunk instead of
 * `initial`.
 *
 * Adding a language: register its basic-language id here AND set
 * `monaco.basicLanguage` to the same id on the descriptor.
 */
const LOADERS: Record<MonacoBasicLanguageId, () => Promise<MonacoBasicLanguageModule>> = {
  javascript: () => import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js'),
  typescript: () => import('monaco-editor/esm/vs/basic-languages/typescript/typescript.js'),
  go: () => import('monaco-editor/esm/vs/basic-languages/go/go.js'),
  python: () => import('monaco-editor/esm/vs/basic-languages/python/python.js'),
  rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.js'),
  lua: () => import('monaco-editor/esm/vs/basic-languages/lua/lua.js'),
  ruby: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.js'),
  yaml: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.js'),
  dockerfile: () => import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.js'),
  shell: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.js'),
  ini: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.js'),
};

/**
 * Load a bundled Monaco basic language by id. The closed id union and the
 * exhaustive loader record guarantee that every descriptor has a tokenizer.
 */
export async function loadBasicLanguage(
  id: MonacoBasicLanguageId
): Promise<MonacoBasicLanguageModule> {
  return LOADERS[id]();
}

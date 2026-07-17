import type { Monaco } from '@monaco-editor/react';
import type { LanguageIntelligenceAdapter } from '../languageIntelligence/types';

export type MonacoCompletionProvider = Parameters<
  Monaco['languages']['registerCompletionItemProvider']
>[1];
export type MonacoHoverProvider = Parameters<Monaco['languages']['registerHoverProvider']>[1];
export type MonacoSignatureHelpProvider = Parameters<
  Monaco['languages']['registerSignatureHelpProvider']
>[1];

export type MonacoLanguageConfiguration = Parameters<
  Monaco['languages']['setLanguageConfiguration']
>[1];
export type MonacoTokensProvider = Parameters<Monaco['languages']['setMonarchTokensProvider']>[1];

export interface MonacoBasicLanguageModule {
  conf: MonacoLanguageConfiguration;
  language: MonacoTokensProvider;
}

interface BaseMonacoLanguageContribution {
  id: string;
  extensions: readonly string[];
  aliases: readonly string[];
}

export type MonacoLanguageContribution =
  | (BaseMonacoLanguageContribution & {
      /**
       * SR-01 — the id of a bundled Monaco basic language. The actual
       * `import('monaco-editor/esm/vs/basic-languages/…')` lives ONLY in
       * `basicLanguageLoaders.ts`, which is dynamically imported at
       * registration time. Keeping these dynamic imports out of the
       * eagerly-reachable descriptor graph stops Rolldown from pinning
       * Vite's `__vitePreload` helper into the Monaco-core chunk, which is
       * what kept Monaco core in the web `initial` bundle.
       */
      basicLanguage: string;
      config?: never;
      language?: never;
    })
  | (BaseMonacoLanguageContribution & {
      basicLanguage?: never;
      config: MonacoLanguageConfiguration;
      language: MonacoTokensProvider;
    });

/**
 * Monaco editor providers for one language, returned by the descriptor's lazy
 * `loadEditorProviders` loader. Every field is optional because each language
 * opts into only the providers it ships. Singular fields hold the language's
 * primary service; plural fields compose cross-cutting additions such as magic
 * comments without replacing that service. The whole bundle is loaded on
 * demand so provider modules stay out of the initial bundle until a tab
 * activates the language.
 */
export interface MonacoEditorProviders {
  createCompletionProvider?: (monaco: Monaco) => MonacoCompletionProvider;
  createCompletionProviders?: readonly ((monaco: Monaco) => MonacoCompletionProvider)[];
  createHoverProvider?: () => MonacoHoverProvider;
  createHoverProviders?: readonly (() => MonacoHoverProvider)[];
  createSignatureHelpProvider?: () => MonacoSignatureHelpProvider;
}

export interface LanguageSupportDescriptor {
  id: string;
  monaco?: MonacoLanguageContribution;
  /**
   * Lazily import this language's Monaco editor providers (completion / hover /
   * signature). Returning dynamic `import()`s keeps each provider module in a
   * per-language chunk; `registerLanguageOnce` awaits this the first time the
   * language is activated. Omit for languages with no custom providers, such
   * as plain file-type tokenizers.
   */
  loadEditorProviders?: () => Promise<MonacoEditorProviders>;
  createLanguageIntelligenceAdapter?: () => LanguageIntelligenceAdapter;
}

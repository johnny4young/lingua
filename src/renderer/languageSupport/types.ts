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
export type MonacoTokensProvider = Parameters<
  Monaco['languages']['setMonarchTokensProvider']
>[1];

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
      loader: () => Promise<MonacoBasicLanguageModule>;
      config?: never;
      language?: never;
    })
  | (BaseMonacoLanguageContribution & {
      loader?: never;
      config: MonacoLanguageConfiguration;
      language: MonacoTokensProvider;
    });

export interface LanguageSupportDescriptor {
  id: string;
  monaco?: MonacoLanguageContribution;
  createCompletionProvider?: (monaco: Monaco) => MonacoCompletionProvider;
  createHoverProvider?: () => MonacoHoverProvider;
  createSignatureHelpProvider?: () => MonacoSignatureHelpProvider;
  createLanguageIntelligenceAdapter?: () => LanguageIntelligenceAdapter;
}

import { createRustCompletionProvider } from '../components/Editor/completionProviders/rustCompletions';
import { createRustHoverProvider } from '../components/Editor/completionProviders/rustHoverProvider';
import { createRustSignatureProvider } from '../components/Editor/completionProviders/rustSignatureProvider';
import type { LanguageSupportDescriptor } from './types';

export const rustLanguageSupport = {
  id: 'rust',
  monaco: {
    id: 'rust',
    extensions: ['.rs'],
    aliases: ['Rust'],
    loader: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.js'),
  },
  createCompletionProvider: createRustCompletionProvider,
  createHoverProvider: createRustHoverProvider,
  createSignatureHelpProvider: createRustSignatureProvider,
} satisfies LanguageSupportDescriptor;

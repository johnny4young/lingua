import { createLspLanguageStore } from './lspLanguageStoreFactory';

/** Live gopls capability state, isolated from the Rust LSP lifecycle. */
export const useGoLanguageStore = createLspLanguageStore();

import { createLspLanguageStore } from './lspLanguageStoreFactory';

/** Live rust-analyzer capability state, isolated from the Go LSP lifecycle. */
export const useRustLanguageStore = createLspLanguageStore();

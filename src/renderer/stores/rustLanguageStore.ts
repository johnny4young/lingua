import {
  createLspLanguageStore,
  type LspLanguageState,
  type LspLanguageStatus,
} from './lspLanguageStoreFactory';

/**
 * implementation — live rust-analyzer capability state. implementation
 * lifted the body into `lspLanguageStoreFactory` so the Go store can
 * reuse the same shape; the rust-facing exports kept their names so
 * every callsite stays byte-identical.
 */

export type RustLanguageStatus = LspLanguageStatus;
export type RustLanguageState = LspLanguageState;

export const useRustLanguageStore = createLspLanguageStore();

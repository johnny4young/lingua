import {
  createLspLanguageStore,
  type LspLanguageState,
  type LspLanguageStatus,
} from './lspLanguageStoreFactory';

/**
 * implementation — live gopls capability state. Identical shape to
 * `useRustLanguageStore`; the two stores are isolated so a Rust crash
 * does not propagate into the Go UI and vice versa.
 */

export type GoLanguageStatus = LspLanguageStatus;
export type GoLanguageState = LspLanguageState;

export const useGoLanguageStore = createLspLanguageStore();

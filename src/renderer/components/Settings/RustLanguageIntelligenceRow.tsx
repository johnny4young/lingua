import { useRustLanguageStore } from '../../stores/rustLanguageStore';
import { LanguageIntelligenceRow } from './LanguageIntelligenceRow';

/**
 * RL-026 Slice 3 — conditional Settings row for the Rust LSP.
 * Slice 4 lifted the body into `LanguageIntelligenceRow`; this file
 * stays as the rust-specific facade so the Settings layout import
 * keeps its name.
 */
export function RustLanguageIntelligenceRow() {
  return (
    <LanguageIntelligenceRow
      language="rust"
      store={useRustLanguageStore}
      copyNamespace="languageIntelligence.rust"
      restartIpc={() => window.lingua.lsp?.rust.restart()}
    />
  );
}

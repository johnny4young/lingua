import { useRustLanguageStore } from '../../stores/rustLanguageStore';
import { LanguageIntelligenceRow } from './LanguageIntelligenceRow';

/**
 * implementation — conditional Settings → Languages row for the Rust LSP.
 * implementation lifted the body into `LanguageIntelligenceRow`; this file
 * stays as the rust-specific facade so the Settings layout import
 * keeps its name.
 */
export function RustLanguageIntelligenceRow({ last = false }: { last?: boolean } = {}) {
  return (
    <LanguageIntelligenceRow
      language="rust"
      store={useRustLanguageStore}
      copyNamespace="languageIntelligence.rust"
      restartIpc={() => window.lingua.lsp?.rust.restart()}
      last={last}
    />
  );
}

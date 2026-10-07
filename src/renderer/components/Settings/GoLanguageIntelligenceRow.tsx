import { useGoLanguageStore } from '../../stores/goLanguageStore';
import { LanguageIntelligenceRow } from './LanguageIntelligenceRow';

/**
 * Conditional Settings → Languages row for the Go LSP. Mirrors
 * `RustLanguageIntelligenceRow` via the shared `LanguageIntelligenceRow`
 * component.
 */
export function GoLanguageIntelligenceRow({ last = false }: { last?: boolean } = {}) {
  return (
    <LanguageIntelligenceRow
      language="go"
      store={useGoLanguageStore}
      copyNamespace="languageIntelligence.go"
      restartIpc={() => window.lingua.lsp?.go.restart()}
      last={last}
    />
  );
}

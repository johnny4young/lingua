import type { Monaco } from '@monaco-editor/react';
import {
  getGoLspAdapter,
  isGoLspAvailable,
} from '../../../languageIntelligence/goAdapterSingleton';

type SignatureProvider = Parameters<
  Monaco['languages']['registerSignatureHelpProvider']
>[1];
type ProvideSignatureHelp = NonNullable<SignatureProvider['provideSignatureHelp']>;
type SigModel = Parameters<ProvideSignatureHelp>[0];
type SigPosition = Parameters<ProvideSignatureHelp>[1];

/**
 * RL-026 Slice 4 — Monaco signature-help provider for Go.
 * Mirrors the Rust counterpart; gopls answers
 * `textDocument/signatureHelp` with the same shape rust-analyzer
 * uses, so the parsing in `go.ts` is shared.
 */
export function createGoSignatureProvider(): SignatureProvider {
  return {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    async provideSignatureHelp(model: SigModel, position: SigPosition) {
      if (!isGoLspAvailable()) return null;
      const adapter = getGoLspAdapter();
      if (!adapter) return null;

      const uri = model.uri.toString();
      adapter.openDocument(uri, model.getValue());

      let signature;
      try {
        signature = await adapter.provideSignatureHelp(
          uri,
          position.lineNumber,
          position.column
        );
      } catch {
        return null;
      }
      if (!signature) return null;

      return {
        value: {
          signatures: [
            {
              label: signature.symbol,
              parameters: signature.parameters.map((parameter) => ({
                label: parameter.label,
              })),
            },
          ],
          activeSignature: 0,
          activeParameter: signature.activeParameter,
        },
        dispose: () => {},
      };
    },
  };
}

import type { Monaco } from '@monaco-editor/react';
import {
  getRustLspAdapter,
  isRustLspAvailable,
} from '../../../languageIntelligence/rustAdapterSingleton';

type SignatureProvider = Parameters<
  Monaco['languages']['registerSignatureHelpProvider']
>[1];
type ProvideSignatureHelp = NonNullable<SignatureProvider['provideSignatureHelp']>;
type SigModel = Parameters<ProvideSignatureHelp>[0];
type SigPosition = Parameters<ProvideSignatureHelp>[1];

/**
 * implementation — Monaco signature-help provider for Rust. Delegates
 * to rust-analyzer via the adapter. `(`, `,` are the natural triggers;
 * Monaco re-asks the provider after each.
 */
export function createRustSignatureProvider(): SignatureProvider {
  return {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    async provideSignatureHelp(model: SigModel, position: SigPosition) {
      if (!isRustLspAvailable()) return null;
      const adapter = getRustLspAdapter();
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

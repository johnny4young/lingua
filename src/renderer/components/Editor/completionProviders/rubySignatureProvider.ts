import type { Monaco } from '@monaco-editor/react';
import i18next from 'i18next';
import { provideRubySignatureHelp } from '../../../languageIntelligence/ruby';

type SignatureProvider = Parameters<
  Monaco['languages']['registerSignatureHelpProvider']
>[1];
type ProvideSignatureHelp = NonNullable<SignatureProvider['provideSignatureHelp']>;
type SignatureModel = Parameters<ProvideSignatureHelp>[0];
type SignaturePosition = Parameters<ProvideSignatureHelp>[1];

export function createRubySignatureProvider(): SignatureProvider {
  return {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [],
    provideSignatureHelp(model: SignatureModel, position: SignaturePosition) {
      const help = provideRubySignatureHelp(
        model.getValue(),
        position.lineNumber,
        position.column
      );
      if (!help) return null;

      const signatureLabel = help.parameters.length
        ? `${help.symbol}(${help.parameters.map(p => p.label).join(', ')})`
        : `${help.symbol}(${i18next.t('languageIntelligence.ruby.signature.empty')})`;

      return {
        dispose() {
          /* No retained resources to release. */
        },
        value: {
          signatures: [
            {
              label: signatureLabel,
              documentation: i18next.t('languageIntelligence.ruby.signature.header'),
              parameters: help.parameters.length
                ? help.parameters.map(param => ({ label: param.label }))
                : [{ label: i18next.t('languageIntelligence.ruby.signature.empty') }],
            },
          ],
          activeSignature: 0,
          activeParameter: help.parameters.length
            ? Math.min(help.activeParameter, Math.max(0, help.parameters.length - 1))
            : 0,
        },
      };
    },
  };
}

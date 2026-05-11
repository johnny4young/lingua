import type { Monaco } from '@monaco-editor/react';
import i18next from 'i18next';
import { providePythonSignatureHelp } from '../../../languageIntelligence/python';

type SignatureProvider = Parameters<
  Monaco['languages']['registerSignatureHelpProvider']
>[1];
type ProvideSignatureHelp = NonNullable<SignatureProvider['provideSignatureHelp']>;
type SignatureModel = Parameters<ProvideSignatureHelp>[0];
type SignaturePosition = Parameters<ProvideSignatureHelp>[1];

export function createPythonSignatureProvider(): SignatureProvider {
  return {
    // `)` is intentionally NOT a retrigger character — Monaco treats
    // retrigger as "fire the provider again while the widget is open",
    // so listing `)` would re-query on the closing paren and produce a
    // visible flicker before our provider's null return dismisses the
    // widget. Letting Monaco's default dismissal handle close-paren is
    // the correct path.
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [],
    provideSignatureHelp(model: SignatureModel, position: SignaturePosition) {
      const help = providePythonSignatureHelp(
        model.getValue(),
        position.lineNumber,
        position.column
      );
      if (!help) return null;

      const signatureLabel = help.parameters.length
        ? `${help.symbol}(${help.parameters.map(p => p.label).join(', ')})`
        : `${help.symbol}(${i18next.t('languageIntelligence.python.signature.empty')})`;

      return {
        dispose() {
          /* No retained resources to release. */
        },
        value: {
          signatures: [
            {
              label: signatureLabel,
              documentation: i18next.t('languageIntelligence.python.signature.header'),
              parameters: help.parameters.length
                ? help.parameters.map(param => ({ label: param.label }))
                : [{ label: i18next.t('languageIntelligence.python.signature.empty') }],
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

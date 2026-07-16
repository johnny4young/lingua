import { EncodeDecodeToggle, TwoPaneTransformPanel, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransformUtilityPanel } from '../useTransformUtilityPanel';
import { decodeBase64, detectsAsBase64, encodeBase64 } from '../../../utils/developerUtilities';

export function Base64UtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const transform = useCallback(
    (value: string) => {
      const decoded = decodeBase64(value);
      return mode === 'encode'
        ? { output: encodeBase64(value), errorKey: null }
        : { output: decoded.value ?? '', errorKey: decoded.errorKey };
    },
    [mode]
  );
  const { input, setInput, output, errorKey } = useTransformUtilityPanel({
    utilityId: 'base64',
    initialInput: 'Lingua utilities',
    transform,
    onPendingInput: () => setMode('decode'),
  });
  const runApply = useCallback(() => {
    setMode(detectsAsBase64(input) ? 'decode' : 'encode');
  }, [input]);

  return (
    <div className="grid gap-4">
      <EncodeDecodeToggle mode={mode} onModeChange={setMode} />
      <UtilityToolbar utilityId="base64" primary={input} run={runApply} setPrimary={setInput} />
      <TwoPaneTransformPanel
        title={t('utilities.tool.base64.title')}
        description={t('utilities.tool.base64.panelDescription')}
        input={input}
        onInputChange={setInput}
        output={output}
        errorKey={errorKey}
        layout="output-wide"
      />
    </div>
  );
}

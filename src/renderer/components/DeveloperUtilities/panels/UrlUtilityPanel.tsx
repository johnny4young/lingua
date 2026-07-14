import { EncodeDecodeToggle, TwoPaneTransformPanel, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransformUtilityPanel } from '../useTransformUtilityPanel';
import * as developerUtilities from '../../../utils/developerUtilities';

export function UrlUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const transform = useCallback(
    (value: string) => {
      const decoded = developerUtilities.decodeUrlComponentValue(value);
      return mode === 'encode'
        ? { output: developerUtilities.encodeUrlComponentValue(value), errorKey: null }
        : { output: decoded.value ?? '', errorKey: decoded.errorKey };
    },
    [mode]
  );
  const { input, setInput, output, errorKey } = useTransformUtilityPanel({
    utilityId: 'url',
    initialInput: 'name=Lingua & scope=utils',
    transform,
  });
  const runApply = useCallback(
    () => setMode(developerUtilities.detectsAsUrlEncoded(input) ? 'decode' : 'encode'),
    [input]
  );

  return (
    <div className="grid gap-4">
      <EncodeDecodeToggle mode={mode} onModeChange={setMode} />
      <UtilityToolbar utilityId="url" primary={input} run={runApply} setPrimary={setInput} />
      <TwoPaneTransformPanel
        title={t('utilities.tool.url.title')}
        description={t('utilities.tool.url.panelDescription')}
        input={input}
        onInputChange={setInput}
        output={output}
        errorKey={errorKey}
        layout="output-wide"
      />
    </div>
  );
}

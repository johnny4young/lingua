import { TwoPaneTransformPanel } from '../panelPrimitives';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { decodeBase64, encodeBase64 } from '../../../utils/developerUtilities';

export function Base64UtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('Lingua utilities');
  const decoded = decodeBase64(input);

  const output = mode === 'encode' ? encodeBase64(input) : decoded.value ?? '';
  const errorKey = mode === 'decode' ? decoded.errorKey : null;

  // RL-069 Slice 1 — encoded / decoded output flows through to the
  // global Cmd+Shift+C handler. When the input has a decode error we
  // intentionally surface null so the shortcut shows the empty toast
  // instead of a malformed value.
  const registerOutput = useCallback(
    () => (errorKey ? null : output || null),
    [errorKey, output]
  );
  useRegisterUtilityOutput(registerOutput);

  return (
    <div className="grid gap-4">
      <div className="inline-flex w-fit overflow-hidden rounded-[1.2rem] border border-border/80 bg-surface-strong/88">
        <button
          type="button"
          className={`px-4 py-2 text-xs font-semibold ${mode === 'encode' ? 'bg-primary-soft text-primary' : 'text-foreground'}`}
          onClick={() => setMode('encode')}
        >
          {t('utilities.actions.encode')}
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-xs font-semibold ${mode === 'decode' ? 'bg-primary-soft text-primary' : 'text-foreground'}`}
          onClick={() => setMode('decode')}
        >
          {t('utilities.actions.decode')}
        </button>
      </div>
      <TwoPaneTransformPanel
        title={t('utilities.tool.base64.title')}
        description={t('utilities.tool.base64.panelDescription')}
        input={input}
        onInputChange={setInput}
        output={output}
        errorKey={errorKey}
      />
    </div>
  );
}

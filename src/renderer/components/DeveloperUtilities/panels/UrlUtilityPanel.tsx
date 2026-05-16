import { TwoPaneTransformPanel, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import {
  decodeUrlComponentValue,
  detectsAsUrlEncoded,
  encodeUrlComponentValue,
} from '../../../utils/developerUtilities';

export function UrlUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('name=Lingua & scope=utils');
  const decoded = decodeUrlComponentValue(input);

  const output = mode === 'encode' ? encodeUrlComponentValue(input) : decoded.value ?? '';
  const errorKey = mode === 'decode' ? decoded.errorKey : null;

  // RL-069 Slice 1 — same convention as Base64: encoded / decoded
  // value when valid, null when errored.
  const registerOutput = useCallback(
    () => (errorKey ? null : output || null),
    [errorKey, output]
  );
  useRegisterUtilityOutput(registerOutput);

  // RL-069 Slice 2 — Apply auto-flips the mode based on detect:
  // input that contains percent-encoded sequences switches to decode;
  // raw input stays in encode.
  const runApply = useCallback(() => {
    setMode(detectsAsUrlEncoded(input) ? 'decode' : 'encode');
  }, [input]);

  return (
    <div className="grid gap-4">
      <div className="inline-flex w-fit overflow-hidden rounded-full border border-border/60 bg-bg-panel-alt">
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
      <UtilityToolbar
        utilityId="url"
        primary={input}
        run={runApply}
        setPrimary={setInput}
      />
      <TwoPaneTransformPanel
        title={t('utilities.tool.url.title')}
        description={t('utilities.tool.url.panelDescription')}
        input={input}
        onInputChange={setInput}
        output={output}
        errorKey={errorKey}
      />
    </div>
  );
}

import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityToolbar,
  UtilityTextarea,
} from '../panelPrimitives';
import { JsonSyntaxOutput } from '../JsonSyntaxOutput';
import { useCallback, useMemo, useState } from 'react';
import { usePendingUtilityInput } from '../usePendingUtilityInput';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { analyzeJson } from '../../../utils/developerUtilities';

export function JsonUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('{\n  "name": "Lingua",\n  "tools": ["json", "base64"]\n}');
  // internal — seed from a smart-pasted JSON snippet.
  usePendingUtilityInput('json', setInput);
  const analysis = useMemo(() => analyzeJson(input), [input]);

  // implementation — register the formatted JSON as the panel's
  // canonical output for Cmd+Shift+C / Cmd+Alt+R. Invalid in-progress
  // edits surface null so the shortcut shows the empty-output toast
  // instead of copying malformed JSON.
  const registerOutput = useCallback(() => analysis.formatted ?? null, [analysis.formatted]);
  useRegisterUtilityOutput(registerOutput);

  // implementation — Apply re-formats the input. For valid JSON the
  // visible output is unchanged (the live memo already produced it),
  // but the success toast confirms the gesture from the keyboard.
  const runApply = useCallback(() => {
    if (analysis.formatted) setInput(analysis.formatted);
  }, [analysis.formatted]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(32rem,1.45fr)] 2xl:grid-cols-[minmax(20rem,0.65fr)_minmax(42rem,1.7fr)]">
      <PanelSection
        title={t('utilities.tool.json.title')}
        description={t('utilities.tool.json.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={event => setInput(event.target.value)}
            className="min-h-[18rem] font-mono"
          />
        </div>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setInput(analysis.formatted ?? input)}
            >
              {t('utilities.tool.json.actions.pretty')}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setInput(analysis.minified ?? input)}
            >
              {t('utilities.tool.json.actions.minify')}
            </button>
            <CopyButton value={input} testid="json-input-copy" disabled={!input} />
          </div>
        )}
        <UtilityToolbar utilityId="json" primary={input} run={runApply} setPrimary={setInput} />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.json.viewerTitle')}
        description={t('utilities.tool.json.viewerDescription')}
      >
        {analysis.errorKey ? (
          <StatusMessage message={t('utilities.tool.json.invalid')} tone="error" />
        ) : analysis.parsed === null ? (
          <StatusMessage message={t('utilities.tool.json.empty')} />
        ) : (
          <JsonSyntaxOutput
            ariaLabel={t('utilities.tool.json.viewerTitle')}
            testid="json-viewer-output"
            value={analysis.formatted ?? ''}
            className="max-h-[34rem]"
          />
        )}
      </PanelSection>
    </div>
  );
}

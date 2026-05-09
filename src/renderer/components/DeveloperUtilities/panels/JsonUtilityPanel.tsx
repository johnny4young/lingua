import { FieldLabel, JsonTreeNode, PanelSection, StatusMessage, UtilityToolbar, UtilityTextarea } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { analyzeJson } from '../../../utils/developerUtilities';

export function JsonUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('{\n  "name": "Lingua",\n  "tools": ["json", "base64"]\n}');
  const analysis = useMemo(() => analyzeJson(input), [input]);

  // RL-069 Slice 1 — register the formatted JSON as the panel's
  // canonical output for Cmd+Shift+C / Cmd+Alt+R. Invalid in-progress
  // edits surface null so the shortcut shows the empty-output toast
  // instead of copying malformed JSON.
  const registerOutput = useCallback(() => analysis.formatted ?? null, [analysis.formatted]);
  useRegisterUtilityOutput(registerOutput);

  // RL-069 Slice 2 — Apply re-formats the input. For valid JSON the
  // visible output is unchanged (the live memo already produced it),
  // but the success toast confirms the gesture from the keyboard.
  const runApply = useCallback(() => {
    if (analysis.formatted) setInput(analysis.formatted);
  }, [analysis.formatted]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <PanelSection
        title={t('utilities.tool.json.title')}
        description={t('utilities.tool.json.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
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
            <CopyButton
              value={input}
              testid="json-input-copy"
              disabled={!input}
            />
          </div>
        )}
        <UtilityToolbar utilityId="json" primary={input} run={runApply} />
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
          <div className="max-h-[26rem] overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
            <JsonTreeNode value={analysis.parsed} />
          </div>
        )}
      </PanelSection>
    </div>
  );
}

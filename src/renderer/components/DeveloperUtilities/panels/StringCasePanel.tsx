import { FieldLabel, PanelSection, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { CASE_KEY_LIST, formatAllCases } from '../../../utils/stringCase';
import type { CaseKey } from '../../../utils/stringCase';

export function StringCasePanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('user profile page');
  const outputs = useMemo(() => formatAllCases(input), [input]);

  // RL-069 Slice 2 — camelCase is the most common copy target across
  // the case variants. Other variants stay reachable via CopyButton.
  const registerOutput = useCallback(
    () => outputs.camel || null,
    [outputs.camel]
  );
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.stringCase.title')}
        description={t('utilities.tool.stringCase.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.stringCase.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.stringCase.input.label')}
            data-testid="string-case-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('utilities.tool.stringCase.input.placeholder')}
            spellCheck={false}
          />
        </div>
        <UtilityToolbar
          utilityId="string-case"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.stringCase.outputsTitle')}
        description={t('utilities.tool.stringCase.outputsDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          {CASE_KEY_LIST.map((key: CaseKey) => {
            const value = outputs[key];
            return (
              <div
                key={key}
                className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
                    {t(`utilities.tool.stringCase.output.${key}`)}
                  </span>
                  <CopyButton
                    value={value}
                    testid={`string-case-${key}-copy`}
                    disabled={!value}
                  />
                </div>
                <span
                  className="break-all font-mono text-sm text-foreground"
                  data-testid={`string-case-${key}`}
                >
                  {value || '—'}
                </span>
              </div>
            );
          })}
        </div>
      </PanelSection>
    </div>
  );
}

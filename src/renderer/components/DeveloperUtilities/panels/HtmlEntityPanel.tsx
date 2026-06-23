import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { decodeHtmlEntities, encodeHtmlEntities } from '../../../utils/htmlEntity';
import { detectsAsEncodedHtmlEntity } from '../../../utils/developerUtilities';
import type { EncodeStrategy } from '../../../utils/htmlEntity';

type HtmlEntityMode = 'encode-minimal' | 'encode-named' | 'encode-numeric' | 'decode';

export function HtmlEntityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<HtmlEntityMode>('encode-named');
  const [input, setInput] = useState('<p class="lead">© 2026 Lingua — ñ</p>');

  const { output, unresolvedCount } = useMemo(() => {
    if (mode === 'decode') {
      const decoded = decodeHtmlEntities(input);
      return { output: decoded.text, unresolvedCount: decoded.unresolvedCount };
    }
    const strategy: EncodeStrategy =
      mode === 'encode-minimal'
        ? 'minimal'
        : mode === 'encode-numeric'
          ? 'numeric'
          : 'named';
    return { output: encodeHtmlEntities(input, strategy), unresolvedCount: 0 };
  }, [input, mode]);

  // RL-069 Slice 2 — register the encoded / decoded value.
  const registerOutput = useCallback(() => output || null, [output]);
  useRegisterUtilityOutput(registerOutput);

  // Apply auto-flips between encode-named and decode based on whether
  // the input contains entities. The two intermediate encode modes
  // (minimal / numeric) are explicit user choices; we don't override
  // them here.
  const runApply = useCallback(() => {
    setMode(detectsAsEncodedHtmlEntity(input) ? 'decode' : 'encode-named');
  }, [input]);

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.htmlEntity.title')}
        description={t('utilities.tool.htmlEntity.panelDescription')}
      >
        <div className="grid gap-2">
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.htmlEntity.mode.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.htmlEntity.mode.label')}
              data-testid="html-entity-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as HtmlEntityMode)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="encode-minimal">
                {t('utilities.tool.htmlEntity.mode.encodeMinimal')}
              </option>
              <option value="encode-named">
                {t('utilities.tool.htmlEntity.mode.encodeNamed')}
              </option>
              <option value="encode-numeric">
                {t('utilities.tool.htmlEntity.mode.encodeNumeric')}
              </option>
              <option value="decode">{t('utilities.tool.htmlEntity.mode.decode')}</option>
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.htmlEntity.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.htmlEntity.input.label')}
            data-testid="html-entity-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        <UtilityToolbar
          utilityId="html-entity"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.htmlEntity.output.label')}
        description={t('utilities.status.live')}
      >
        <div className="relative">
          <UtilityTextarea
            aria-label={t('utilities.tool.htmlEntity.output.label')}
            data-testid="html-entity-output"
            readOnly
            value={output}
            className="pr-10"
            spellCheck={false}
          />
          <div className="absolute right-2 top-2">
            <CopyButton value={output} testid="html-entity-output-copy" disabled={!output} />
          </div>
        </div>
        {mode === 'decode' && unresolvedCount > 0 ? (
          <StatusMessage
            tone="muted"
            message={t('utilities.tool.htmlEntity.decode.unresolved', { count: unresolvedCount })}
          />
        ) : null}
      </PanelSection>
    </div>
  );
}

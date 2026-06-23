import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityTextarea,
  UtilityToolbar,
} from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { SVG_TO_CSS_MAX_KB, convertSvgToCss } from '../../../utils/svgToCss';
import type { SvgToCssEncoding } from '../../../utils/svgToCss';

const DEFAULT_SVG_TO_CSS_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 22 2 22"/></svg>`;

export function SvgToCssPanel() {
  const { t } = useTranslation();
  const [encoding, setEncoding] = useState<SvgToCssEncoding>('base64');
  const [input, setInput] = useState(DEFAULT_SVG_TO_CSS_SAMPLE);
  const result = useMemo(() => convertSvgToCss(input, { encoding }), [input, encoding]);

  const registerOutput = useCallback(() => (result.ok ? result.dataUri : null), [result]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput(prev => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.svgToCss.title')}
        description={t('utilities.tool.svgToCss.panelDescription')}
      >
        <label className="grid gap-1 text-body-sm text-muted">
          <FieldLabel>{t('utilities.tool.svgToCss.mode.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.svgToCss.mode.label')}
            data-testid="svg-to-css-mode"
            value={encoding}
            onChange={event => setEncoding(event.target.value as SvgToCssEncoding)}
            className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
          >
            <option value="base64">{t('utilities.tool.svgToCss.mode.base64')}</option>
            <option value="percent">{t('utilities.tool.svgToCss.mode.percent')}</option>
          </select>
        </label>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.svgToCss.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.svgToCss.input.label')}
            data-testid="svg-to-css-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[12rem]"
          />
        </div>
        <UtilityToolbar
          utilityId="svg-to-css"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.svgToCss.css.label')}
        description={t('utilities.status.live')}
      >
        {!result.ok ? (
          <StatusMessage
            message={t(result.errorKey, { limitKb: SVG_TO_CSS_MAX_KB })}
            tone={result.errorKey === 'utilities.tool.svgToCss.error.empty' ? 'muted' : 'error'}
          />
        ) : (
          <div className="grid gap-3">
            {result.size ? (
              <StatusMessage
                tone="muted"
                testid="svg-to-css-size"
                message={t('utilities.tool.svgToCss.size.detected', {
                  width: result.size.width,
                  height: result.size.height,
                })}
              />
            ) : null}
            <div className="grid gap-2">
              <FieldLabel>{t('utilities.tool.svgToCss.dataUri.label')}</FieldLabel>
              <div className="relative">
                <UtilityTextarea
                  aria-label={t('utilities.tool.svgToCss.dataUri.label')}
                  data-testid="svg-to-css-data-uri"
                  value={result.dataUri}
                  readOnly
                  spellCheck={false}
                  className="pr-10 min-h-[12rem] font-mono"
                />
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={result.dataUri}
                    testid="svg-to-css-data-uri-copy"
                    disabled={!result.dataUri}
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <FieldLabel>{t('utilities.tool.svgToCss.css.label')}</FieldLabel>
              <div className="relative">
                <UtilityTextarea
                  aria-label={t('utilities.tool.svgToCss.css.label')}
                  data-testid="svg-to-css-block"
                  value={result.cssBlock}
                  readOnly
                  spellCheck={false}
                  className="pr-10 min-h-[14rem] font-mono"
                />
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={result.cssBlock}
                    testid="svg-to-css-block-copy"
                    disabled={!result.cssBlock}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { HTML_TO_JSX_MAX_KB, convertHtmlToJsx } from '../../../utils/htmlToJsx';
import type { HtmlToJsxResult } from '../../../utils/htmlToJsx';

const DEFAULT_HTML_TO_JSX_SAMPLE = `<div class="card" style="color: red; margin: 10px">
  <label for="name">Name</label>
  <input type="text" checked>
  <br>
  <!-- a comment -->
</div>`;

export function HtmlToJsxPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(DEFAULT_HTML_TO_JSX_SAMPLE);
  const [wrapInFragment, setWrapInFragment] = useState(true);
  const result: HtmlToJsxResult = useMemo(
    () => convertHtmlToJsx(input, { wrapInFragment }),
    [input, wrapInFragment]
  );

  const registerOutput = useCallback(
    () => (result.ok ? result.jsx : null),
    [result]
  );
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.htmlToJsx.title')}
        description={t('utilities.tool.htmlToJsx.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.htmlToJsx.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.htmlToJsx.input.label')}
            data-testid="html-to-jsx-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[14rem] font-mono"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            data-testid="html-to-jsx-wrap-fragment"
            checked={wrapInFragment}
            onChange={(event) => setWrapInFragment(event.target.checked)}
          />
          <span>{t('utilities.tool.htmlToJsx.wrapFragment')}</span>
        </label>
        <UtilityToolbar utilityId="html-to-jsx" primary={input} run={runApply} />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.htmlToJsx.output.label')}
        description={t('utilities.status.live')}
      >
        {!result.ok ? (
          <StatusMessage
            message={t(result.errorKey, { limitKb: HTML_TO_JSX_MAX_KB })}
            tone={result.errorKey === 'utilities.tool.htmlToJsx.error.empty' ? 'muted' : 'error'}
            testid="html-to-jsx-error"
          />
        ) : (
          <div className="grid gap-2">
            <StatusMessage
              tone="muted"
              testid="html-to-jsx-root-count"
              message={t('utilities.tool.htmlToJsx.rootCount', { count: result.rootCount })}
            />
            <div className="relative">
              <UtilityTextarea
                aria-label={t('utilities.tool.htmlToJsx.output.label')}
                data-testid="html-to-jsx-output"
                value={result.jsx}
                readOnly
                spellCheck={false}
                className="pr-10 min-h-[14rem] font-mono"
              />
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={result.jsx}
                  testid="html-to-jsx-output-copy"
                  disabled={!result.jsx}
                />
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

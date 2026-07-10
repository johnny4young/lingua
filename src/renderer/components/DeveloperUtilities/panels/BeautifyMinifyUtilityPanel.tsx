import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityTextarea,
  UtilityToolbar,
} from '../panelPrimitives';
import { JsonSyntaxOutput } from '../JsonSyntaxOutput';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { formatSource } from '../../../utils/formatters';
import { minifySource } from '../../../utils/minify';
import type { MinifyLanguage } from '../../../utils/minify';

type BeautifyMinifyMode = 'beautify' | 'minify';

export function BeautifyMinifyUtilityPanel() {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<MinifyLanguage>('json');
  const [mode, setMode] = useState<BeautifyMinifyMode>('beautify');
  const [input, setInput] = useState('{\n  "greeting": "Hello, World!",\n  "count": 3\n}');
  const [output, setOutput] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (input === '') {
        if (!cancelled) {
          setOutput('');
          setErrorKey(null);
        }
        return;
      }

      if (mode === 'beautify') {
        const result = await formatSource(language, input);
        if (cancelled) return;
        if (result.ok) {
          setOutput(result.formatted);
          setErrorKey(null);
        } else {
          setOutput('');
          setErrorKey('utilities.tool.beautifyMinify.parseError');
        }
        return;
      }

      const result = await minifySource(language, input);
      if (cancelled) return;
      if (result.ok) {
        setOutput(result.output);
        setErrorKey(null);
      } else {
        setOutput('');
        setErrorKey('utilities.tool.beautifyMinify.parseError');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [language, mode, input]);

  const handleLanguageChange = (next: MinifyLanguage) => {
    // Switching language resets the error so the panel doesn't claim the new
    // language's parser failed before it ran.
    setLanguage(next);
    setErrorKey(null);
  };

  // RL-069 Slice 2 — output null while errored so the shortcut surfaces
  // the empty-output toast instead of stale content.
  const registerOutput = useCallback(() => (errorKey ? null : output || null), [errorKey, output]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput(prev => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.beautifyMinify.title')}
        description={t('utilities.tool.beautifyMinify.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.beautifyMinify.languageLabel')}</FieldLabel>
            <select
              data-testid="beautify-minify-language"
              value={language}
              onChange={event => handleLanguageChange(event.target.value as MinifyLanguage)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="json">{t('utilities.tool.beautifyMinify.language.json')}</option>
              <option value="javascript">
                {t('utilities.tool.beautifyMinify.language.javascript')}
              </option>
              <option value="html">{t('utilities.tool.beautifyMinify.language.html')}</option>
              <option value="css">{t('utilities.tool.beautifyMinify.language.css')}</option>
              <option value="scss">{t('utilities.tool.beautifyMinify.language.scss')}</option>
              <option value="less">{t('utilities.tool.beautifyMinify.language.less')}</option>
              <option value="xml">{t('utilities.tool.beautifyMinify.language.xml')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.beautifyMinify.modeLabel')}</FieldLabel>
            <select
              data-testid="beautify-minify-mode"
              value={mode}
              onChange={event => setMode(event.target.value as BeautifyMinifyMode)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="beautify">{t('utilities.tool.beautifyMinify.mode.beautify')}</option>
              <option value="minify">{t('utilities.tool.beautifyMinify.mode.minify')}</option>
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            data-testid="beautify-minify-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[16rem] font-mono"
          />
        </div>
        {language === 'html' && mode === 'minify' ? (
          <StatusMessage message={t('utilities.tool.beautifyMinify.htmlMinifyHint')} />
        ) : null}
        {(language === 'css' || language === 'scss' || language === 'less') && mode === 'minify' ? (
          <StatusMessage message={t('utilities.tool.beautifyMinify.cssFamilyMinifyHint')} />
        ) : null}
        {language === 'xml' && mode === 'minify' ? (
          <StatusMessage message={t('utilities.tool.beautifyMinify.xmlMinifyHint')} />
        ) : null}
        <UtilityToolbar
          utilityId="beautify-minify"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection title={t('utilities.field.output')} description={t('utilities.status.live')}>
        {errorKey ? (
          <StatusMessage message={t(errorKey)} tone="error" />
        ) : (
          <div className="relative">
            {language === 'json' ? (
              <JsonSyntaxOutput
                ariaLabel={t('utilities.field.output')}
                testid="beautify-minify-output"
                value={output}
                className="min-h-[20rem] pr-10"
              />
            ) : (
              <UtilityTextarea
                aria-label={t('utilities.field.output')}
                data-testid="beautify-minify-output"
                value={output}
                readOnly
                spellCheck={false}
                className="pr-10 min-h-[20rem] font-mono"
              />
            )}
            <div className="absolute right-2 top-2">
              <CopyButton value={output} disabled={!output} />
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

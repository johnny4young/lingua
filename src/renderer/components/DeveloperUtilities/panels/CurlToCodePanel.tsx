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
import { CURL_TARGETS, CURL_TO_CODE_MAX_KB, convertCurlToCode } from '../../../utils/curlToCode';
import type { ConvertCurlResult, CurlTarget } from '../../../utils/curlToCode';

const DEFAULT_CURL_SAMPLE = `curl -X POST \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Lingua"}' \\\n  https://api.example.com/users`;

const CURL_TARGET_I18N_KEYS: Record<CurlTarget, string> = {
  fetch: 'utilities.tool.curlToCode.target.fetch',
  undici: 'utilities.tool.curlToCode.target.undici',
  requests: 'utilities.tool.curlToCode.target.requests',
  'net-http': 'utilities.tool.curlToCode.target.netHttp',
};

export function CurlToCodePanel() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<CurlTarget>('fetch');
  const [input, setInput] = useState(DEFAULT_CURL_SAMPLE);
  const result: ConvertCurlResult = useMemo(
    () => convertCurlToCode(input, { target }),
    [input, target]
  );

  const registerOutput = useCallback(() => (result.ok ? result.code : null), [result]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput(prev => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.curlToCode.title')}
        description={t('utilities.tool.curlToCode.panelDescription')}
      >
        <label className="grid gap-1 text-body-sm text-muted">
          <FieldLabel>{t('utilities.tool.curlToCode.target.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.curlToCode.target.label')}
            data-testid="curl-to-code-target"
            value={target}
            onChange={event => setTarget(event.target.value as CurlTarget)}
            className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
          >
            {CURL_TARGETS.map(option => (
              <option key={option} value={option}>
                {t(CURL_TARGET_I18N_KEYS[option])}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.curlToCode.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.curlToCode.input.label')}
            data-testid="curl-to-code-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder={t('utilities.tool.curlToCode.input.placeholder') ?? undefined}
            spellCheck={false}
            className="min-h-[16rem] font-mono"
          />
        </div>
        <UtilityToolbar
          utilityId="curl-to-code"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.curlToCode.output.label')}
        description={t('utilities.status.live')}
      >
        {!result.ok ? (
          <StatusMessage
            message={t(result.errorKey, { limitKb: CURL_TO_CODE_MAX_KB })}
            tone={result.errorKey === 'utilities.tool.curlToCode.error.empty' ? 'muted' : 'error'}
            testid="curl-to-code-error"
          />
        ) : (
          <div className="grid gap-2">
            {result.command.warnings.length > 0 ? (
              <StatusMessage
                tone="warning"
                testid="curl-to-code-warnings"
                message={t('utilities.tool.curlToCode.warnings', {
                  count: result.command.warnings.length,
                })}
              />
            ) : null}
            <div className="relative">
              <UtilityTextarea
                aria-label={t('utilities.tool.curlToCode.output.label')}
                data-testid="curl-to-code-output"
                value={result.code}
                readOnly
                spellCheck={false}
                className="pr-10 min-h-[20rem] font-mono"
              />
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={result.code}
                  testid="curl-to-code-output-copy"
                  disabled={!result.code}
                />
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { isParsedUrl, parseUrl } from '../../../utils/urlParser';
import type { ParsedQueryParam } from '../../../utils/urlParser';

const URL_PARSER_SAMPLE = 'https://user:secret@api.lingua.dev:8443/v1/items?tag=dev&tag=web&page=2#results';

interface UrlReadoutField {
  labelKey: string;
  value: string;
  testid: string;
  sensitive?: boolean;
}

function UrlReadoutCard({
  label,
  value,
  testid,
  sensitive = false,
  revealed = false,
  onToggleReveal,
  revealLabel,
  hideLabel,
}: {
  label: string;
  value: string;
  testid: string;
  sensitive?: boolean;
  revealed?: boolean;
  onToggleReveal?: () => void;
  revealLabel?: string;
  hideLabel?: string;
}) {
  const hidden = sensitive && !revealed && value.length > 0;
  const display = hidden ? '•'.repeat(Math.min(value.length, 12)) : value || '—';
  return (
    <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</span>
        <div className="flex items-center gap-1">
          {sensitive && value.length > 0 && onToggleReveal ? (
            <button
              type="button"
              onClick={onToggleReveal}
              className="rounded-[0.6rem] border border-border/80 px-2 py-1 text-[11px] font-medium text-muted hover:border-border-strong/90 hover:text-foreground"
              data-testid={`${testid}-reveal`}
            >
              {revealed ? hideLabel : revealLabel}
            </button>
          ) : null}
          <CopyButton
            value={value}
            testid={`${testid}-copy`}
            disabled={!value}
          />
        </div>
      </div>
      <span
        className="break-all font-mono text-sm text-foreground"
        data-testid={testid}
      >
        {display}
      </span>
    </div>
  );
}

export function UrlParserPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(URL_PARSER_SAMPLE);
  const [revealPassword, setRevealPassword] = useState(false);

  const parsed = useMemo(() => parseUrl(input), [input]);

  // RL-069 Slice 2 — origin is the most useful clipboard target for
  // a parsed URL; href stays available via the per-row CopyButton.
  const registerOutput = useCallback(
    () => (isParsedUrl(parsed) ? parsed.origin || parsed.href || null : null),
    [parsed]
  );
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.urlParser.title')}
        description={t('utilities.tool.urlParser.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            data-testid="url-parser-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        {!isParsedUrl(parsed) ? (
          <StatusMessage
            message={t(
              parsed.error === 'empty'
                ? 'utilities.tool.urlParser.error.empty'
                : 'utilities.tool.urlParser.error.invalid'
            )}
            tone={parsed.error === 'invalid' ? 'error' : 'muted'}
          />
        ) : null}
        <UtilityToolbar
          utilityId="url-parser"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      {isParsedUrl(parsed) ? (
        <>
          <PanelSection
            title={t('utilities.tool.urlParser.parts.title')}
            description={t('utilities.tool.urlParser.parts.description')}
          >
            <div className="grid gap-2 md:grid-cols-2">
              {(
                [
                  { labelKey: 'utilities.tool.urlParser.field.protocol', value: parsed.protocol, testid: 'url-parser-protocol' },
                  { labelKey: 'utilities.tool.urlParser.field.origin', value: parsed.origin, testid: 'url-parser-origin' },
                  { labelKey: 'utilities.tool.urlParser.field.username', value: parsed.username, testid: 'url-parser-username' },
                  { labelKey: 'utilities.tool.urlParser.field.password', value: parsed.password, testid: 'url-parser-password', sensitive: true },
                  { labelKey: 'utilities.tool.urlParser.field.hostname', value: parsed.hostname, testid: 'url-parser-hostname' },
                  { labelKey: 'utilities.tool.urlParser.field.port', value: parsed.port, testid: 'url-parser-port' },
                  { labelKey: 'utilities.tool.urlParser.field.pathname', value: parsed.pathname, testid: 'url-parser-pathname' },
                  { labelKey: 'utilities.tool.urlParser.field.search', value: parsed.search, testid: 'url-parser-search' },
                  { labelKey: 'utilities.tool.urlParser.field.hash', value: parsed.hash, testid: 'url-parser-hash' },
                  { labelKey: 'utilities.tool.urlParser.field.href', value: parsed.href, testid: 'url-parser-href' },
                ] satisfies UrlReadoutField[]
              ).map((field) => (
                <UrlReadoutCard
                  key={field.testid}
                  label={t(field.labelKey)}
                  value={field.value}
                  testid={field.testid}
                  sensitive={field.sensitive}
                  revealed={revealPassword}
                  onToggleReveal={
                    field.sensitive
                      ? () => setRevealPassword((prev) => !prev)
                      : undefined
                  }
                  revealLabel={t('utilities.tool.urlParser.password.reveal')}
                  hideLabel={t('utilities.tool.urlParser.password.hide')}
                />
              ))}
            </div>
          </PanelSection>

          <PanelSection
            title={t('utilities.tool.urlParser.query.title')}
            description={t('utilities.tool.urlParser.query.description')}
          >
            {parsed.query.length === 0 ? (
              <StatusMessage
                message={t('utilities.tool.urlParser.query.empty')}
              />
            ) : (
              <div
                className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3"
                data-testid="url-parser-query-table"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2 pb-1 text-[11px] uppercase tracking-[0.16em] text-muted">
                  <span>{t('utilities.tool.urlParser.query.header.key')}</span>
                  <span>{t('utilities.tool.urlParser.query.header.value')}</span>
                  <span className="sr-only">
                    {t('utilities.tool.urlParser.query.header.copy')}
                  </span>
                </div>
                {parsed.query.map((entry: ParsedQueryParam, index: number) => (
                  <div
                    key={`${entry.key}-${index}`}
                    data-testid="url-parser-query-row"
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2 border-t border-border/60 pt-1 first:border-t-0 first:pt-0"
                  >
                    <span className="truncate font-mono text-sm text-foreground">
                      {entry.key}
                    </span>
                    <span className="break-all font-mono text-sm text-muted">
                      {entry.value}
                    </span>
                    <CopyButton
                      value={entry.value}
                      testid={`url-parser-query-copy-${index}`}
                      disabled={!entry.value}
                    />
                  </div>
                ))}
              </div>
            )}
          </PanelSection>
        </>
      ) : null}
    </div>
  );
}

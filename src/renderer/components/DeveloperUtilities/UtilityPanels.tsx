import { Palette } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { CopyButton } from './CopyButton';
import {
  analyzeColor,
  analyzeJson,
  analyzeRegex,
  analyzeTimestamp,
  decodeBase64,
  decodeJwt,
  decodeUrlComponentValue,
  encodeBase64,
  encodeUrlComponentValue,
  generateUuid,
  hashText,
} from '../../utils/developerUtilities';
import {
  MAX_BASE,
  MIN_BASE,
  formatInBase,
  isValidBase,
  parseInAnyBase,
} from '../../utils/numberBase';
import { isParsedUrl, parseUrl, type ParsedQueryParam } from '../../utils/urlParser';
import { CASE_KEY_LIST, formatAllCases, type CaseKey } from '../../utils/stringCase';
import { computeDiff, summarizeDiff, type DiffGranularity, type DiffSegment } from '../../utils/diff';
import {
  decodeHtmlEntities,
  encodeHtmlEntities,
  type EncodeStrategy,
} from '../../utils/htmlEntity';
import {
  inspect as inspectString,
  type CharacterCategory,
  type WarningKind,
} from '../../utils/stringInspector';
import {
  generateUlid,
  generateUuidV7,
  inspectIdentifier,
  type IdentifierKind,
} from '../../utils/uuid';
import { formatSource } from '../../utils/formatters';
import { minifySource, type MinifyLanguage } from '../../utils/minify';

function PanelSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-[1.4rem] border border-border/80 bg-surface/58 p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs leading-5 text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{children}</label>;
}

function UtilityTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-36 w-full rounded-[1.15rem] border border-border/80 bg-background/88 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50 ${
        props.className ?? ''
      }`}
    />
  );
}

function UtilityInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50 ${
        props.className ?? ''
      }`}
    />
  );
}

function StatusMessage({
  message,
  tone = 'muted',
}: {
  message: string;
  tone?: 'muted' | 'error' | 'success';
}) {
  const toneClass =
    tone === 'error'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : 'text-muted';
  return <p className={`text-xs leading-5 ${toneClass}`}>{message}</p>;
}

function JsonTreeNode({
  label,
  value,
}: {
  label?: string;
  value: unknown;
}) {
  if (Array.isArray(value)) {
    return (
      <div className="grid gap-2 pl-4">
        <div className="text-xs font-medium text-foreground">
          {label ? `${label}: ` : ''}
          <span className="text-muted">[{value.length}]</span>
        </div>
        <div className="grid gap-2 border-l border-border/70 pl-3">
          {value.map((entry, index) => (
            <JsonTreeNode key={`${label ?? 'array'}-${index}`} label={String(index)} value={entry} />
          ))}
        </div>
      </div>
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="grid gap-2 pl-4">
        <div className="text-xs font-medium text-foreground">
          {label ? `${label}: ` : ''}
          <span className="text-muted">{'{'}{entries.length}{'}'}</span>
        </div>
        <div className="grid gap-2 border-l border-border/70 pl-3">
          {entries.map(([key, entry]) => (
            <JsonTreeNode key={`${label ?? 'object'}-${key}`} label={key} value={entry} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs text-foreground">
      {label ? <span className="font-medium text-foreground">{label}: </span> : null}
      <span className="text-muted">{String(value)}</span>
    </div>
  );
}

function JsonUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('{\n  "name": "Lingua",\n  "tools": ["json", "base64"]\n}');
  const analysis = useMemo(() => analyzeJson(input), [input]);

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

function TwoPaneTransformPanel({
  title,
  description,
  input,
  onInputChange,
  output,
  errorKey,
}: {
  title: string;
  description: string;
  input: string;
  onInputChange: (value: string) => void;
  output: string;
  errorKey: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <PanelSection title={title} description={description}>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
          />
        </div>
      </PanelSection>
      <PanelSection
        title={t('utilities.field.output')}
        description={errorKey ? t('utilities.status.invalid') : t('utilities.status.live')}
      >
        <div className="relative">
          <UtilityTextarea
            aria-label={t('utilities.field.output')}
            readOnly
            value={output}
            className={errorKey ? 'pr-10 text-danger' : 'pr-10'}
          />
          <div className="absolute right-2 top-2">
            <CopyButton value={output} disabled={!output || Boolean(errorKey)} />
          </div>
        </div>
        {errorKey ? <StatusMessage message={t(errorKey)} tone="error" /> : null}
      </PanelSection>
    </div>
  );
}

function Base64UtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('Lingua utilities');
  const decoded = decodeBase64(input);

  const output = mode === 'encode' ? encodeBase64(input) : decoded.value ?? '';
  const errorKey = mode === 'decode' ? decoded.errorKey : null;

  return (
    <div className="grid gap-4">
      <div className="inline-flex w-fit overflow-hidden rounded-[1.2rem] border border-border/80 bg-surface-strong/88">
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
      <TwoPaneTransformPanel
        title={t('utilities.tool.base64.title')}
        description={t('utilities.tool.base64.panelDescription')}
        input={input}
        onInputChange={setInput}
        output={output}
        errorKey={errorKey}
      />
    </div>
  );
}

function UrlUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('name=Lingua & scope=utils');
  const decoded = decodeUrlComponentValue(input);

  const output = mode === 'encode' ? encodeUrlComponentValue(input) : decoded.value ?? '';
  const errorKey = mode === 'decode' ? decoded.errorKey : null;

  return (
    <div className="grid gap-4">
      <div className="inline-flex w-fit overflow-hidden rounded-[1.2rem] border border-border/80 bg-surface-strong/88">
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

function UrlParserPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(URL_PARSER_SAMPLE);
  const [revealPassword, setRevealPassword] = useState(false);

  const parsed = useMemo(() => parseUrl(input), [input]);

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

function StringCasePanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('user profile page');
  const outputs = useMemo(() => formatAllCases(input), [input]);

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

type HtmlEntityMode = 'encode-minimal' | 'encode-named' | 'encode-numeric' | 'decode';

function HtmlEntityPanel() {
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

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.htmlEntity.title')}
        description={t('utilities.tool.htmlEntity.panelDescription')}
      >
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.htmlEntity.mode.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.htmlEntity.mode.label')}
              data-testid="html-entity-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as HtmlEntityMode)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
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

function StringInspectorPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('hello\u200Bworld');
  const report = useMemo(() => inspectString(input), [input]);

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.stringInspector.title')}
        description={t('utilities.tool.stringInspector.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.stringInspector.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.stringInspector.input.label')}
            data-testid="string-inspector-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <InspectorCountCard
            label={t('utilities.tool.stringInspector.summary.graphemes')}
            value={report.counts.graphemesApprox}
            testid="string-inspector-graphemes"
          />
          <InspectorCountCard
            label={t('utilities.tool.stringInspector.summary.utf16')}
            value={report.counts.charactersUtf16}
            testid="string-inspector-utf16"
          />
          <InspectorCountCard
            label={t('utilities.tool.stringInspector.summary.utf8Bytes')}
            value={report.counts.bytesUtf8}
            testid="string-inspector-utf8"
          />
        </div>
      </PanelSection>

      {report.warnings.length > 0 ? (
        <PanelSection
          title={t('utilities.tool.stringInspector.warnings.title')}
          description={t('utilities.tool.stringInspector.warnings.description')}
        >
          <ul className="grid gap-1" data-testid="string-inspector-warnings">
            {report.warnings.map((warning) => (
              <li
                key={warning.kind}
                data-testid={`string-inspector-warning-${warning.kind}`}
                className="rounded-[0.9rem] border border-warning/60 bg-warning/10 px-3 py-2 text-xs text-warning"
              >
                {t(warningKeyForKind(warning.kind), { count: warning.at.length })}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <PanelSection
        title={t('utilities.tool.stringInspector.table.title')}
        description={t('utilities.tool.stringInspector.table.description')}
      >
        {report.characters.length === 0 ? (
          <StatusMessage message={t('utilities.tool.stringInspector.table.empty')} />
        ) : (
          <div
            className="max-h-[26rem] overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65"
            data-testid="string-inspector-table"
          >
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface/88 text-[11px] uppercase tracking-[0.16em] text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.index')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.glyph')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.codepoint')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.category')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.characters.map((row) => (
                  <tr
                    key={row.index}
                    data-testid="string-inspector-row"
                    data-category={row.category}
                    className="border-t border-border/60 font-mono"
                  >
                    <td className="px-3 py-1 tabular-nums text-muted">{row.index}</td>
                    <td className="px-3 py-1 text-foreground">{row.glyph}</td>
                    <td className="px-3 py-1 tabular-nums text-foreground">{row.hex}</td>
                    <td className="px-3 py-1 text-muted">
                      {t(categoryKey(row.category))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.truncated ? (
          <StatusMessage
            tone="muted"
            message={t('utilities.tool.stringInspector.truncated', {
              count: report.characters.length,
            })}
          />
        ) : null}
      </PanelSection>
    </div>
  );
}

function InspectorCountCard({
  label,
  value,
  testid,
}: {
  label: string;
  value: number;
  testid: string;
}) {
  return (
    <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</span>
      <span className="font-mono text-sm text-foreground" data-testid={testid}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function warningKeyForKind(kind: WarningKind): string {
  return `utilities.tool.stringInspector.warning.${kind === 'zero-width' ? 'zeroWidth' : kind === 'bidi-control' ? 'bidiControl' : kind === 'mixed-script' ? 'mixedScript' : 'homoglyph'}`;
}

function categoryKey(category: CharacterCategory): string {
  return `utilities.tool.stringInspector.category.${category}`;
}

type UuidKind = 'v4' | 'v7' | 'ulid';

function generateIdentifier(kind: UuidKind): string {
  if (kind === 'v4') return generateUuid();
  if (kind === 'v7') return generateUuidV7();
  return generateUlid();
}

function kindLabelKey(kind: IdentifierKind): string {
  if (kind === 'uuid-v7') return 'utilities.tool.uuid.version.v7';
  if (kind === 'uuid-v4') return 'utilities.tool.uuid.version.v4';
  return 'utilities.tool.uuid.version.ulid';
}

function UuidUtilityPanel() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<UuidKind>('v4');
  const [values, setValues] = useState<string[]>(() =>
    Array.from({ length: 3 }, () => generateIdentifier('v4'))
  );
  const [decoderInput, setDecoderInput] = useState('');
  const decoded = useMemo(() => {
    const trimmed = decoderInput.trim();
    return trimmed ? inspectIdentifier(trimmed) : null;
  }, [decoderInput]);

  const regenerate = (nextKind: UuidKind = kind) => {
    setValues(Array.from({ length: 3 }, () => generateIdentifier(nextKind)));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <PanelSection
        title={t('utilities.tool.uuid.title')}
        description={t('utilities.tool.uuid.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.uuid.version.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.uuid.version.label')}
            data-testid="uuid-version-select"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as UuidKind;
              setKind(next);
              regenerate(next);
            }}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            <option value="v4">{t('utilities.tool.uuid.version.v4')}</option>
            <option value="v7">{t('utilities.tool.uuid.version.v7')}</option>
            <option value="ulid">{t('utilities.tool.uuid.version.ulid')}</option>
          </select>
        </div>
        <button
          type="button"
          className="button-primary w-fit"
          onClick={() => regenerate()}
        >
          {t('utilities.tool.uuid.actions.regenerate')}
        </button>
        <div className="grid gap-2">
          {values.map((value, index) => (
            <div
              key={value}
              data-testid="uuid-generated-value"
              className="flex items-center justify-between gap-2 rounded-[1rem] border border-border/80 bg-background/70 px-3 py-2 font-mono text-sm text-foreground"
            >
              <span className="truncate">{value}</span>
              <CopyButton
                value={value}
                testid={`uuid-generated-value-copy-${index}`}
              />
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.uuid.decode.title')}
        description={t('utilities.tool.uuid.decode.description')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.uuid.decode.inputLabel')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.uuid.decode.inputLabel')}
            data-testid="uuid-decoder-input"
            value={decoderInput}
            onChange={(event) => setDecoderInput(event.target.value)}
            placeholder={t('utilities.tool.uuid.decode.placeholder')}
            spellCheck={false}
          />
        </div>
        {decoderInput.trim() === '' ? (
          <StatusMessage message={t('utilities.tool.uuid.decode.idle')} />
        ) : decoded === null ? (
          <StatusMessage
            message={t('utilities.tool.uuid.decode.unrecognized')}
            tone="error"
          />
        ) : (
          <div className="grid gap-2" data-testid="uuid-decoder-result">
            <StatusMessage
              message={t('utilities.tool.uuid.decode.kind', {
                kind: t(kindLabelKey(decoded.kind)),
              })}
              tone="success"
            />
            {decoded.timestamp ? (
              <StatusMessage
                message={t('utilities.tool.uuid.decode.timestamp', {
                  value: decoded.timestamp.toISOString(),
                })}
              />
            ) : null}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

function HashUtilityPanel() {
  const { t } = useTranslation();
  const [algorithm, setAlgorithm] = useState<'SHA-1' | 'SHA-256'>('SHA-256');
  const [input, setInput] = useState('Lingua');
  const [digest, setDigest] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void hashText(input, algorithm)
      .then((value) => {
        if (!cancelled) {
          setDigest(value);
          setErrorKey(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDigest('');
          setErrorKey('utilities.tool.hash.error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [algorithm, input]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <PanelSection
        title={t('utilities.tool.hash.title')}
        description={t('utilities.tool.hash.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.algorithm')}</FieldLabel>
          <select
            aria-label={t('utilities.field.algorithm')}
            value={algorithm}
            onChange={(event) => setAlgorithm(event.target.value as 'SHA-1' | 'SHA-256')}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            <option value="SHA-256">{t('utilities.tool.hash.algorithms.sha256')}</option>
            <option value="SHA-1">{t('utilities.tool.hash.algorithms.sha1')}</option>
          </select>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
      </PanelSection>
      <PanelSection
        title={t('utilities.field.output')}
        description={t('utilities.status.live')}
      >
        <div className="relative">
          <UtilityTextarea
            aria-label={t('utilities.field.output')}
            readOnly
            value={digest}
            className="pr-10"
          />
          <div className="absolute right-2 top-2">
            <CopyButton value={digest} disabled={!digest || Boolean(errorKey)} />
          </div>
        </div>
        {errorKey ? <StatusMessage message={t(errorKey)} tone="error" /> : null}
      </PanelSection>
    </div>
  );
}

function TimestampUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const analysis = useMemo(() => analyzeTimestamp(input), [input]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <PanelSection
        title={t('utilities.tool.timestamp.title')}
        description={t('utilities.tool.timestamp.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="button-secondary w-fit"
          onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}
        >
          {t('utilities.tool.timestamp.actions.useNow')}
        </button>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.timestamp.outputsTitle')}
        description={t('utilities.tool.timestamp.outputsDescription')}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.seconds')}
            value={analysis.unixSeconds ?? null}
            testid="timestamp-output-seconds"
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.milliseconds')}
            value={analysis.unixMilliseconds ?? null}
            testid="timestamp-output-milliseconds"
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.iso')}
            value={analysis.iso ?? null}
            testid="timestamp-output-iso"
            fullWidth
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.local')}
            value={analysis.local ?? null}
            testid="timestamp-output-local"
            fullWidth
            monospace={false}
          />
        </div>
      </PanelSection>
    </div>
  );
}

function TimestampOutputCard({
  label,
  value,
  testid,
  fullWidth = false,
  monospace = true,
}: {
  label: string;
  /** Raw value for the cell. `null` renders the placeholder and disables copy. */
  value: string | number | null;
  testid: string;
  fullWidth?: boolean;
  monospace?: boolean;
}) {
  const hasValue = value !== null && value !== undefined && String(value).length > 0;
  const stringValue = hasValue ? String(value) : '';
  const textClass = `${monospace ? 'font-mono ' : ''}text-sm text-foreground`;
  return (
    <div
      className={`grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3 ${
        fullWidth ? 'md:col-span-2' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</span>
        <CopyButton value={stringValue} testid={`${testid}-copy`} disabled={!hasValue} />
      </div>
      <span className={textClass} data-testid={testid}>
        {hasValue ? stringValue : '—'}
      </span>
    </div>
  );
}

function JwtUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaW5ndWEiLCJyb2xlIjoiZGV2In0.signature'
  );
  const analysis = useMemo(() => decodeJwt(input), [input]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <PanelSection
        title={t('utilities.tool.jwt.title')}
        description={t('utilities.tool.jwt.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.token')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.field.token')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </PanelSection>

      <div className="grid gap-4">
        <PanelSection
          title={t('utilities.tool.jwt.headerTitle')}
          description={t('utilities.tool.jwt.headerDescription')}
        >
          {analysis.header ? (
            <div className="grid gap-2">
              <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
                <JsonTreeNode value={analysis.header} />
              </div>
              <div className="flex justify-end">
                <CopyButton
                  value={JSON.stringify(analysis.header, null, 2)}
                  testid="jwt-header-copy"
                />
              </div>
            </div>
          ) : (
            <StatusMessage message={t('utilities.tool.jwt.empty')} />
          )}
        </PanelSection>
        <PanelSection
          title={t('utilities.tool.jwt.payloadTitle')}
          description={t('utilities.tool.jwt.payloadDescription')}
        >
          {analysis.payload ? (
            <div className="grid gap-2">
              <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
                <JsonTreeNode value={analysis.payload} />
              </div>
              <div className="flex justify-end">
                <CopyButton
                  value={JSON.stringify(analysis.payload, null, 2)}
                  testid="jwt-payload-copy"
                />
              </div>
            </div>
          ) : (
            <StatusMessage message={t('utilities.tool.jwt.empty')} />
          )}
        </PanelSection>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </div>
    </div>
  );
}

function RegexUtilityPanel() {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState('(\\w+)@(\\w+\\.\\w+)');
  const [flags, setFlags] = useState('g');
  const [input, setInput] = useState('hello@lingua.dev and support@example.com');
  const analysis = useMemo(() => analyzeRegex(pattern, flags, input), [pattern, flags, input]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.regex.title')}
        description={t('utilities.tool.regex.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.regex.fieldPattern')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.regex.fieldPattern')}
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.regex.fieldFlags')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.regex.fieldFlags')}
            value={flags}
            onChange={(event) => setFlags(event.target.value)}
            spellCheck={false}
            maxLength={10}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.regex.fieldInput')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.regex.fieldInput')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.regex.matchesTitle')}
        description={t('utilities.tool.regex.matchesDescription')}
      >
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : analysis.matches.length === 0 ? (
          <StatusMessage message={t('utilities.tool.regex.empty')} />
        ) : (
          <div className="grid gap-2">
            <StatusMessage
              tone="success"
              message={t('utilities.tool.regex.count', { count: analysis.matches.length })}
            />
            <div className="max-h-[24rem] overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
              <ul className="grid gap-2">
                {analysis.matches.map((entry, index) => (
                  <li
                    key={`${entry.index}-${index}`}
                    className="grid gap-1 rounded-[0.9rem] border border-border/70 bg-surface/55 px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm text-foreground">{entry.match}</span>
                      <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
                        {t('utilities.tool.regex.indexLabel', { index: entry.index })}
                      </span>
                    </div>
                    {entry.groups.length > 0 ? (
                      <ul className="grid gap-1">
                        {entry.groups.map((group, groupIndex) => (
                          <li
                            key={`${entry.index}-group-${groupIndex}`}
                            className="flex items-baseline justify-between gap-2 font-mono text-xs text-muted"
                          >
                            <span>
                              {group.name
                                ? t('utilities.tool.regex.namedGroupLabel', { name: group.name })
                                : t('utilities.tool.regex.groupLabel', { index: groupIndex + 1 })}
                            </span>
                            <span className="text-foreground">{group.value}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            {analysis.truncated ? (
              <StatusMessage message={t('utilities.tool.regex.truncated')} />
            ) : null}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

function ColorOutputCard({
  label,
  value,
  display,
  testid,
}: {
  label: string;
  /** Raw value to copy; empty string disables the copy button. */
  value: string;
  /** What to render inside the card (may include a placeholder dash). */
  display: string;
  testid?: string;
}) {
  return (
    <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</span>
        <CopyButton value={value} testid={testid ? `${testid}-copy` : undefined} disabled={!value} />
      </div>
      <span className="font-mono text-sm text-foreground" data-testid={testid}>
        {display}
      </span>
    </div>
  );
}

function ColorUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState('#4f46e5');
  const analysis = useMemo(() => analyzeColor(input), [input]);
  const swatch = analysis.hex ?? 'transparent';

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <PanelSection
        title={t('utilities.tool.color.title')}
        description={t('utilities.tool.color.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.color.fieldInput')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.color.fieldInput')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>
            <span className="inline-flex items-center gap-1.5">
              <Palette size={12} className="text-muted" aria-hidden="true" />
              {t('utilities.tool.color.fieldPicker')}
            </span>
          </FieldLabel>
          <label
            className="inline-flex cursor-pointer items-center gap-3 rounded-[0.9rem] border border-border/80 bg-background/88 px-3 py-2 transition-colors hover:border-border-strong/90"
            aria-label={t('utilities.tool.color.fieldPicker')}
          >
            <input
              type="color"
              aria-label={t('utilities.tool.color.fieldPicker')}
              value={analysis.hex ?? '#000000'}
              onChange={(event) => setInput(event.target.value)}
              className="h-7 w-10 cursor-pointer rounded-[0.55rem] border border-border/60 bg-transparent p-0"
            />
            <span className="text-xs text-muted">{t('utilities.tool.color.pickerHint')}</span>
          </label>
        </div>
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : (
          <StatusMessage tone="success" message={t('utilities.tool.color.valid')} />
        )}
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.color.outputsTitle')}
        description={t('utilities.tool.color.outputsDescription')}
      >
        <div
          aria-label={t('utilities.tool.color.swatchLabel')}
          className="h-24 w-full rounded-[1.1rem] border border-border/80"
          style={{ backgroundColor: swatch }}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ColorOutputCard
            label={t('utilities.tool.color.outputs.hex')}
            value={analysis.hex ?? ''}
            display={analysis.hex ?? '—'}
            testid="color-output-hex"
          />
          <ColorOutputCard
            label={t('utilities.tool.color.outputs.rgb')}
            value={
              analysis.rgb
                ? `rgb(${analysis.rgb.r}, ${analysis.rgb.g}, ${analysis.rgb.b})`
                : ''
            }
            display={
              analysis.rgb
                ? `rgb(${analysis.rgb.r}, ${analysis.rgb.g}, ${analysis.rgb.b})`
                : '—'
            }
            testid="color-output-rgb"
          />
          <div className="md:col-span-2">
            <ColorOutputCard
              label={t('utilities.tool.color.outputs.hsl')}
              value={
                analysis.hsl
                  ? `hsl(${analysis.hsl.h}, ${analysis.hsl.s}%, ${analysis.hsl.l}%)`
                  : ''
              }
              display={
                analysis.hsl
                  ? `hsl(${analysis.hsl.h}, ${analysis.hsl.s}%, ${analysis.hsl.l}%)`
                  : '—'
              }
              testid="color-output-hsl"
            />
          </div>
        </div>
      </PanelSection>
    </div>
  );
}

function DiffUtilityPanel() {
  const { t } = useTranslation();
  const [left, setLeft] = useState('line one\nline two\nline three');
  const [right, setRight] = useState('line one\nline two updated\nline three\nline four');
  const [granularity, setGranularity] = useState<DiffGranularity>('line');

  const segments = useMemo(
    () => computeDiff(left, right, granularity),
    [left, right, granularity]
  );
  const summary = useMemo(() => summarizeDiff(segments), [segments]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <PanelSection
          title={t('utilities.tool.diff.leftTitle')}
          description={t('utilities.tool.diff.leftDescription')}
        >
          <UtilityTextarea
            aria-label={t('utilities.tool.diff.leftTitle')}
            value={left}
            onChange={(event) => setLeft(event.target.value)}
            spellCheck={false}
          />
        </PanelSection>
        <PanelSection
          title={t('utilities.tool.diff.rightTitle')}
          description={t('utilities.tool.diff.rightDescription')}
        >
          <UtilityTextarea
            aria-label={t('utilities.tool.diff.rightTitle')}
            value={right}
            onChange={(event) => setRight(event.target.value)}
            spellCheck={false}
          />
        </PanelSection>
      </div>
      <PanelSection
        title={t('utilities.tool.diff.resultTitle')}
        description={t('utilities.tool.diff.resultDescription')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <span>{t('utilities.tool.diff.granularity.label')}</span>
            <select
              aria-label={t('utilities.tool.diff.granularity.label')}
              data-testid="diff-granularity-select"
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as DiffGranularity)}
              className="rounded-[0.9rem] border border-border/80 bg-background/88 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="line">{t('utilities.tool.diff.granularity.line')}</option>
              <option value="word">{t('utilities.tool.diff.granularity.word')}</option>
              <option value="character">
                {t('utilities.tool.diff.granularity.character')}
              </option>
            </select>
          </label>
          <StatusMessage
            tone="muted"
            message={t('utilities.tool.diff.summary', {
              added: summary.add,
              removed: summary.remove,
              same: summary.equal,
            })}
          />
        </div>
        {segments.length === 0 ? (
          <StatusMessage message={t('utilities.tool.diff.empty')} />
        ) : granularity === 'line' ? (
          <DiffLineResult segments={segments} />
        ) : (
          <DiffInlineResult segments={segments} />
        )}
      </PanelSection>
    </div>
  );
}

function DiffLineResult({ segments }: { segments: readonly DiffSegment[] }) {
  const rows = useMemo(() => segmentsToLineRows(segments), [segments]);
  return (
    <div
      className="max-h-[26rem] overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65"
      data-testid="diff-result-line"
    >
      <ul className="grid">
        {rows.map((row, index) => {
          const prefix = row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' ';
          const toneClass =
            row.kind === 'add'
              ? 'bg-success/10 text-success'
              : row.kind === 'remove'
                ? 'bg-danger/10 text-danger'
                : 'text-foreground';
          return (
            <li
              key={`${row.kind}-${index}`}
              data-testid={`diff-line-${row.kind}`}
              className={`flex items-baseline gap-2 px-3 py-1 font-mono text-xs ${toneClass}`}
            >
              <span className="w-4 select-none text-muted">{prefix}</span>
              <span className="whitespace-pre-wrap break-words">{row.text || ' '}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DiffInlineResult({ segments }: { segments: readonly DiffSegment[] }) {
  return (
    <div
      className="max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-[1.1rem] border border-border/80 bg-background/65 px-3 py-3 font-mono text-xs leading-5 text-foreground"
      data-testid="diff-result-inline"
    >
      {segments.map((segment, index) => {
        const toneClass =
          segment.kind === 'add'
            ? 'bg-success/15 text-success'
            : segment.kind === 'remove'
              ? 'bg-danger/15 text-danger line-through'
              : '';
        return (
          <span
            key={`${segment.kind}-${index}`}
            data-testid={`diff-segment-${segment.kind}`}
            className={toneClass}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}

interface DiffLineRow {
  kind: DiffSegment['kind'];
  text: string;
}

/**
 * Line-mode segments are already bare lines (tokenizer strips trailing
 * newlines), so a row maps 1:1 to a segment. The helper keeps the call
 * site explicit about its expectations and normalizes the empty-row
 * edge case.
 */
function segmentsToLineRows(segments: readonly DiffSegment[]): DiffLineRow[] {
  return segments.map((segment) => ({ kind: segment.kind, text: segment.text }));
}

interface NumberBaseView {
  readonly id: 'binary' | 'octal' | 'decimal' | 'hex' | 'custom';
  readonly base: number;
  readonly labelKey: string;
  readonly testId: string;
}

const NUMBER_BASE_STATIC_VIEWS: readonly NumberBaseView[] = [
  { id: 'binary', base: 2, labelKey: 'utilities.tool.numberBase.input.binary', testId: 'number-base-input-binary' },
  { id: 'octal', base: 8, labelKey: 'utilities.tool.numberBase.input.octal', testId: 'number-base-input-octal' },
  { id: 'decimal', base: 10, labelKey: 'utilities.tool.numberBase.input.decimal', testId: 'number-base-input-decimal' },
  { id: 'hex', base: 16, labelKey: 'utilities.tool.numberBase.input.hex', testId: 'number-base-input-hex' },
];

function NumberBaseUtilityPanel() {
  const { t } = useTranslation();
  // Single source of truth: the parsed bigint. Views derive their rendered
  // string from `value` unless the view is the one the user is currently
  // editing (tracked via `editingId`) — that way invalid transient input in
  // one view doesn't stomp the other views' formatted output.
  const [value, setValue] = useState<bigint>(255n);
  const [draft, setDraft] = useState<Record<NumberBaseView['id'], string>>({
    binary: '11111111',
    octal: '377',
    decimal: '255',
    hex: 'FF',
    custom: '',
  });
  const [editingId, setEditingId] = useState<NumberBaseView['id'] | null>(null);
  const [invalidId, setInvalidId] = useState<NumberBaseView['id'] | null>(null);
  const [customBase, setCustomBase] = useState(7);

  const views = useMemo<readonly NumberBaseView[]>(
    () => [
      ...NUMBER_BASE_STATIC_VIEWS,
      {
        id: 'custom',
        base: customBase,
        labelKey: 'utilities.tool.numberBase.input.custom',
        testId: 'number-base-input-custom',
      },
    ],
    [customBase]
  );

  const rendered = useMemo<Record<NumberBaseView['id'], string>>(() => {
    const output: Record<NumberBaseView['id'], string> = {
      binary: formatInBase(value, 2),
      octal: formatInBase(value, 8),
      decimal: formatInBase(value, 10),
      hex: formatInBase(value, 16),
      custom: isValidBase(customBase) ? formatInBase(value, customBase) : '',
    };
    if (editingId) {
      output[editingId] = draft[editingId];
    }
    return output;
  }, [value, editingId, draft, customBase]);

  const handleChange = (view: NumberBaseView, nextInput: string) => {
    setEditingId(view.id);
    setDraft((prev) => ({ ...prev, [view.id]: nextInput }));
    const parsed = parseInAnyBase(nextInput, view.base);
    if (parsed === null) {
      setInvalidId(view.id);
      return;
    }
    setInvalidId(null);
    setValue(parsed);
  };

  const handleBlur = () => {
    // On blur we exit editing mode so every view re-derives from `value`,
    // erasing any stale draft that happened to be the active one.
    setEditingId(null);
    setInvalidId(null);
  };

  return (
    <PanelSection
      title={t('utilities.tool.numberBase.title')}
      description={t('utilities.tool.numberBase.panelDescription')}
    >
      <div className="grid gap-3">
        {views.map((view) => {
          const isInvalid = invalidId === view.id;
          return (
            <div key={view.id} className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>{t(view.labelKey)}</FieldLabel>
                {view.id === 'custom' ? (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span>{t('utilities.tool.numberBase.customBaseLabel')}</span>
                    <input
                      type="number"
                      min={MIN_BASE}
                      max={MAX_BASE}
                      value={customBase}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (isValidBase(next)) setCustomBase(next);
                      }}
                      aria-label={t('utilities.tool.numberBase.customBaseLabel')}
                      className="w-16 rounded-[0.75rem] border border-border/80 bg-background/88 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                    />
                  </label>
                ) : null}
              </div>
              <UtilityInput
                aria-label={t(view.labelKey)}
                data-testid={view.testId}
                value={rendered[view.id]}
                onChange={(event) => handleChange(view, event.target.value)}
                onBlur={handleBlur}
                className={
                  isInvalid
                    ? 'border-danger/70 focus:border-danger'
                    : undefined
                }
                spellCheck={false}
              />
            </div>
          );
        })}
      </div>
      {invalidId ? (
        <StatusMessage message={t('utilities.tool.numberBase.invalidInput')} tone="error" />
      ) : (
        <StatusMessage message={t('utilities.status.live')} />
      )}
    </PanelSection>
  );
}

type BeautifyMinifyMode = 'beautify' | 'minify';

function BeautifyMinifyUtilityPanel() {
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

      const result = minifySource(language, input);
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

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.beautifyMinify.title')}
        description={t('utilities.tool.beautifyMinify.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.beautifyMinify.languageLabel')}</FieldLabel>
            <select
              data-testid="beautify-minify-language"
              value={language}
              onChange={(event) => handleLanguageChange(event.target.value as MinifyLanguage)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="json">{t('utilities.tool.beautifyMinify.language.json')}</option>
              <option value="javascript">
                {t('utilities.tool.beautifyMinify.language.javascript')}
              </option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.beautifyMinify.modeLabel')}</FieldLabel>
            <select
              data-testid="beautify-minify-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as BeautifyMinifyMode)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
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
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        {language === 'javascript' && mode === 'minify' ? (
          <StatusMessage message={t('utilities.tool.beautifyMinify.jsMinifyHint')} />
        ) : null}
      </PanelSection>

      <PanelSection
        title={t('utilities.field.output')}
        description={t('utilities.status.live')}
      >
        {errorKey ? (
          <StatusMessage message={t(errorKey)} tone="error" />
        ) : (
          <div className="relative">
            <UtilityTextarea
              aria-label={t('utilities.field.output')}
              data-testid="beautify-minify-output"
              value={output}
              readOnly
              spellCheck={false}
              className="pr-10"
            />
            <div className="absolute right-2 top-2">
              <CopyButton value={output} disabled={!output} />
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

export function DeveloperUtilityPanel({ toolId }: { toolId: DeveloperUtilityId }) {
  if (toolId === 'json') {
    return <JsonUtilityPanel />;
  }

  if (toolId === 'base64') {
    return <Base64UtilityPanel />;
  }

  if (toolId === 'url') {
    return <UrlUtilityPanel />;
  }

  if (toolId === 'url-parser') {
    return <UrlParserPanel />;
  }

  if (toolId === 'uuid') {
    return <UuidUtilityPanel />;
  }

  if (toolId === 'hash') {
    return <HashUtilityPanel />;
  }

  if (toolId === 'timestamp') {
    return <TimestampUtilityPanel />;
  }

  if (toolId === 'regex') {
    return <RegexUtilityPanel />;
  }

  if (toolId === 'color') {
    return <ColorUtilityPanel />;
  }

  if (toolId === 'diff') {
    return <DiffUtilityPanel />;
  }

  if (toolId === 'number-base') {
    return <NumberBaseUtilityPanel />;
  }

  if (toolId === 'beautify-minify') {
    return <BeautifyMinifyUtilityPanel />;
  }

  if (toolId === 'string-case') {
    return <StringCasePanel />;
  }

  if (toolId === 'html-entity') {
    return <HtmlEntityPanel />;
  }

  if (toolId === 'string-inspector') {
    return <StringInspectorPanel />;
  }

  return <JwtUtilityPanel />;
}

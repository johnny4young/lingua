import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import {
  analyzeColor,
  analyzeJson,
  analyzeRegex,
  analyzeTimestamp,
  computeLineDiff,
  decodeBase64,
  decodeJwt,
  decodeUrlComponentValue,
  encodeBase64,
  encodeUrlComponentValue,
  generateUuid,
  hashText,
} from '../../utils/developerUtilities';

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
          <div className="grid gap-3 md:grid-cols-2">
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
        <UtilityTextarea
          aria-label={t('utilities.field.output')}
          readOnly
          value={output}
          className={errorKey ? 'text-danger' : ''}
        />
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

function UuidUtilityPanel() {
  const { t } = useTranslation();
  const [values, setValues] = useState<string[]>(() =>
    Array.from({ length: 3 }, () => generateUuid())
  );

  return (
    <PanelSection
      title={t('utilities.tool.uuid.title')}
      description={t('utilities.tool.uuid.panelDescription')}
    >
      <button
        type="button"
        className="button-primary w-fit"
        onClick={() => setValues(Array.from({ length: 3 }, () => generateUuid()))}
      >
        {t('utilities.tool.uuid.actions.regenerate')}
      </button>
      <div className="grid gap-2">
        {values.map((value) => (
          <div
            key={value}
            className="rounded-[1rem] border border-border/80 bg-background/70 px-3 py-2 font-mono text-sm text-foreground"
          >
            {value}
          </div>
        ))}
      </div>
    </PanelSection>
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
        <UtilityTextarea
          aria-label={t('utilities.field.output')}
          readOnly
          value={digest}
        />
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
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.timestamp.outputs.seconds')}
            </span>
            <span className="font-mono text-sm text-foreground">
              {analysis.unixSeconds ?? '—'}
            </span>
          </div>
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.timestamp.outputs.milliseconds')}
            </span>
            <span className="font-mono text-sm text-foreground">
              {analysis.unixMilliseconds ?? '—'}
            </span>
          </div>
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3 md:col-span-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.timestamp.outputs.iso')}
            </span>
            <span className="font-mono text-sm text-foreground">{analysis.iso ?? '—'}</span>
          </div>
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3 md:col-span-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.timestamp.outputs.local')}
            </span>
            <span className="text-sm text-foreground">{analysis.local ?? '—'}</span>
          </div>
        </div>
      </PanelSection>
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
            <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
              <JsonTreeNode value={analysis.header} />
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
            <div className="max-h-48 overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65 p-3">
              <JsonTreeNode value={analysis.payload} />
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
          <FieldLabel>{t('utilities.tool.color.fieldPicker')}</FieldLabel>
          <input
            type="color"
            aria-label={t('utilities.tool.color.fieldPicker')}
            value={analysis.hex ?? '#000000'}
            onChange={(event) => setInput(event.target.value)}
            className="h-10 w-20 cursor-pointer rounded-[0.9rem] border border-border/80 bg-background/88"
          />
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
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.color.outputs.hex')}
            </span>
            <span className="font-mono text-sm text-foreground">{analysis.hex ?? '—'}</span>
          </div>
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.color.outputs.rgb')}
            </span>
            <span className="font-mono text-sm text-foreground">
              {analysis.rgb ? `rgb(${analysis.rgb.r}, ${analysis.rgb.g}, ${analysis.rgb.b})` : '—'}
            </span>
          </div>
          <div className="grid gap-1 rounded-[1rem] border border-border/80 bg-background/65 px-3 py-3 md:col-span-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t('utilities.tool.color.outputs.hsl')}
            </span>
            <span className="font-mono text-sm text-foreground">
              {analysis.hsl
                ? `hsl(${analysis.hsl.h}, ${analysis.hsl.s}%, ${analysis.hsl.l}%)`
                : '—'}
            </span>
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
  const analysis = useMemo(() => computeLineDiff(left, right), [left, right]);

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
        <StatusMessage
          tone="muted"
          message={t('utilities.tool.diff.summary', {
            added: analysis.addCount,
            removed: analysis.removeCount,
            same: analysis.sameCount,
          })}
        />
        {analysis.lines.length === 0 ? (
          <StatusMessage message={t('utilities.tool.diff.empty')} />
        ) : (
          <div className="max-h-[26rem] overflow-auto rounded-[1.1rem] border border-border/80 bg-background/65">
            <ul className="grid">
              {analysis.lines.map((line, index) => {
                const prefix = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
                const toneClass =
                  line.kind === 'add'
                    ? 'bg-success/10 text-success'
                    : line.kind === 'remove'
                      ? 'bg-danger/10 text-danger'
                      : 'text-foreground';
                return (
                  <li
                    key={`${line.kind}-${index}`}
                    className={`flex items-baseline gap-2 px-3 py-1 font-mono text-xs ${toneClass}`}
                  >
                    <span className="w-4 select-none text-muted">{prefix}</span>
                    <span className="whitespace-pre-wrap break-words">{line.value || ' '}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {analysis.truncated ? (
          <StatusMessage message={t('utilities.tool.diff.truncated')} />
        ) : null}
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

  return <JwtUtilityPanel />;
}

import { FieldLabel, PanelSection, StatusMessage, UtilityInput, UtilityTextarea } from '../panelPrimitives';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../CopyButton';
import { analyzeRegex, applyRegexReplace } from '../../../utils/developerUtilities';

type RegexMode = 'match' | 'replace';

export function RegexUtilityPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<RegexMode>('match');
  const [pattern, setPattern] = useState('(\\w+)@(\\w+\\.\\w+)');
  const [flags, setFlags] = useState('g');
  const [input, setInput] = useState('hello@lingua.dev and support@example.com');
  const [replacement, setReplacement] = useState('[$1 at $2]');
  const analysis = useMemo(() => analyzeRegex(pattern, flags, input), [pattern, flags, input]);
  const replaceResult = useMemo(
    () => applyRegexReplace(pattern, flags, input, replacement),
    [pattern, flags, input, replacement],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.regex.title')}
        description={t('utilities.tool.regex.panelDescription')}
      >
        <label className="grid gap-1 text-xs text-muted">
          <FieldLabel>{t('utilities.tool.regex.mode.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.regex.mode.label')}
            data-testid="regex-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as RegexMode)}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            <option value="match">{t('utilities.tool.regex.mode.match')}</option>
            <option value="replace">{t('utilities.tool.regex.mode.replace')}</option>
          </select>
        </label>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.regex.fieldPattern')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.regex.fieldPattern')}
            data-testid="regex-pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.regex.fieldFlags')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.regex.fieldFlags')}
            data-testid="regex-flags"
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
            data-testid="regex-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        {mode === 'replace' ? (
          <div className="grid gap-2">
            <FieldLabel>{t('utilities.tool.regex.fieldReplacement')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.regex.fieldReplacement')}
              data-testid="regex-replacement"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder={t('utilities.tool.regex.replace.placeholder') ?? undefined}
              spellCheck={false}
            />
          </div>
        ) : null}
        {analysis.errorKey ? (
          <StatusMessage message={t(analysis.errorKey)} tone="error" />
        ) : null}
      </PanelSection>

      {mode === 'match' ? (
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
      ) : (
        <PanelSection
          title={t('utilities.tool.regex.replace.outputTitle')}
          description={t('utilities.tool.regex.replace.outputDescription')}
        >
          {!replaceResult.ok ? (
            <StatusMessage message={t(replaceResult.errorKey)} tone="error" />
          ) : !pattern ? (
            <StatusMessage message={t('utilities.tool.regex.replace.empty')} />
          ) : replaceResult.replacementCount === 0 ? (
            // Mirror Match mode: a valid pattern with zero matches shows
            // a neutral status, not a green "0 replacements" success banner.
            <StatusMessage message={t('utilities.tool.regex.empty')} />
          ) : (
            <div className="grid gap-2">
              <StatusMessage
                tone="success"
                testid="regex-replace-count"
                message={t('utilities.tool.regex.replace.count', {
                  count: replaceResult.replacementCount,
                })}
              />
              <div className="relative">
                <UtilityTextarea
                  aria-label={t('utilities.tool.regex.replace.outputTitle')}
                  data-testid="regex-replace-output"
                  value={replaceResult.output}
                  readOnly
                  spellCheck={false}
                  className="pr-10"
                />
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={replaceResult.output}
                    testid="regex-replace-output-copy"
                    disabled={!replaceResult.output}
                  />
                </div>
              </div>
              {replaceResult.truncatedCount ? (
                <StatusMessage message={t('utilities.tool.regex.truncated')} />
              ) : null}
            </div>
          )}
        </PanelSection>
      )}
    </div>
  );
}

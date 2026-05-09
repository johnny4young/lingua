import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { SQL_DIALECTS, SQL_FORMATTER_MAX_KB, formatSql } from '../../../utils/sqlFormatter';
import type { FormatSqlResult, SqlDialect, SqlFormatOptions } from '../../../utils/sqlFormatter';

const DEFAULT_SQL_SAMPLE = `select id, name, created_at from users where deleted_at is null and tenant_id = ? order by created_at desc limit 25;`;

const SQL_DIALECT_KEYS: Record<SqlDialect, string> = {
  sql: 'utilities.tool.sqlFormatter.dialect.ansi',
  postgresql: 'utilities.tool.sqlFormatter.dialect.postgresql',
  mysql: 'utilities.tool.sqlFormatter.dialect.mysql',
};

export function SqlFormatterPanel() {
  const { t } = useTranslation();
  const [dialect, setDialect] = useState<SqlDialect>('sql');
  const [tabWidth, setTabWidth] = useState<2 | 4>(2);
  const [keywordCase, setKeywordCase] =
    useState<SqlFormatOptions['keywordCase']>('upper');
  const [input, setInput] = useState(DEFAULT_SQL_SAMPLE);
  const [result, setResult] = useState<FormatSqlResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await formatSql(input, { dialect, tabWidth, keywordCase });
        if (!cancelled) setResult(next);
      } catch (error) {
        if (!cancelled) {
          setResult({
            ok: false,
            errorKey: 'utilities.tool.sqlFormatter.error.loadFailure',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input, dialect, tabWidth, keywordCase]);

  const registerOutput = useCallback(
    () => (result && result.ok ? result.output : null),
    [result]
  );
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.sqlFormatter.title')}
        description={t('utilities.tool.sqlFormatter.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-3">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.sqlFormatter.dialect.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.sqlFormatter.dialect.label')}
              data-testid="sql-formatter-dialect"
              value={dialect}
              onChange={(event) => setDialect(event.target.value as SqlDialect)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              {SQL_DIALECTS.map((value) => (
                <option key={value} value={value}>
                  {t(SQL_DIALECT_KEYS[value])}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.sqlFormatter.tabWidth.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.sqlFormatter.tabWidth.label')}
              data-testid="sql-formatter-tab-width"
              value={tabWidth}
              onChange={(event) => setTabWidth(Number(event.target.value) as 2 | 4)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value={2}>{t('utilities.tool.sqlFormatter.tabWidth.two')}</option>
              <option value={4}>{t('utilities.tool.sqlFormatter.tabWidth.four')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.sqlFormatter.keywordCase.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.sqlFormatter.keywordCase.label')}
              data-testid="sql-formatter-keyword-case"
              value={keywordCase}
              onChange={(event) =>
                setKeywordCase(event.target.value as SqlFormatOptions['keywordCase'])
              }
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="preserve">
                {t('utilities.tool.sqlFormatter.keywordCase.preserve')}
              </option>
              <option value="upper">{t('utilities.tool.sqlFormatter.keywordCase.upper')}</option>
              <option value="lower">{t('utilities.tool.sqlFormatter.keywordCase.lower')}</option>
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.sqlFormatter.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.sqlFormatter.input.label')}
            data-testid="sql-formatter-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[14rem] font-mono"
          />
        </div>
        <UtilityToolbar utilityId="sql-formatter" primary={input} run={runApply} />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.sqlFormatter.output.label')}
        description={t('utilities.status.live')}
      >
        {result === null ? (
          <StatusMessage message={t('utilities.tool.sqlFormatter.error.empty')} tone="muted" />
        ) : !result.ok ? (
          <StatusMessage
            message={t(result.errorKey, { limitKb: SQL_FORMATTER_MAX_KB })}
            tone={
              result.errorKey === 'utilities.tool.sqlFormatter.error.empty' ? 'muted' : 'error'
            }
            testid="sql-formatter-error"
          />
        ) : (
          <div className="relative">
            <UtilityTextarea
              aria-label={t('utilities.tool.sqlFormatter.output.label')}
              data-testid="sql-formatter-output"
              value={result.output}
              readOnly
              spellCheck={false}
              className="pr-10 min-h-[14rem] font-mono"
            />
            <div className="absolute right-2 top-2">
              <CopyButton
                value={result.output}
                testid="sql-formatter-output-copy"
                disabled={!result.output}
              />
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

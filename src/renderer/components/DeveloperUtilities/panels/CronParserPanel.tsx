import { FieldLabel, PanelSection, StatusMessage, UtilityInput, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { CRON_PARSER_MAX_NEXT, parseCronExpression } from '../../../utils/cronParser';
import type { CronParserLocale, ParseCronResult } from '../../../utils/cronParser';

const DEFAULT_CRON_EXPRESSION = '*/5 * * * *';
const DEFAULT_CRON_NEXT_COUNT = 5;

function resolveCronLocale(language: string | undefined): CronParserLocale {
  return language && language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function formatCronRunTimestamp(date: Date, locale: string): string {
  // ISO fallback when Intl is unavailable (edge environments); normal path
  // is the locale-aware short datetime format so rows read naturally.
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString();
  }
}

export function CronParserPanel() {
  const { t, i18n } = useTranslation();
  const [expression, setExpression] = useState(DEFAULT_CRON_EXPRESSION);
  const [nextCount, setNextCount] = useState(DEFAULT_CRON_NEXT_COUNT);
  const [result, setResult] = useState<ParseCronResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const locale = resolveCronLocale(i18n.language);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    // Wrap the promise in a try/catch via an async IIFE so an unexpected
    // rejection in the helper (module-load failures from the dynamic
    // imports, mostly) doesn't leave `isLoading` stuck on forever.
    void (async () => {
      try {
        const next = await parseCronExpression(expression, { locale, nextCount });
        if (!cancelled) {
          setResult(next);
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            ok: false,
            errorKey: 'utilities.tool.cron.error.loadFailure',
            message: error instanceof Error ? error.message : String(error),
          });
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expression, locale, nextCount]);

  const handleCountChange = (raw: number) => {
    if (!Number.isFinite(raw)) {
      setNextCount(DEFAULT_CRON_NEXT_COUNT);
      return;
    }
    const clamped = Math.max(1, Math.min(CRON_PARSER_MAX_NEXT, Math.floor(raw)));
    setNextCount(clamped);
  };

  // RL-069 Slice 2 — emit the human-readable description (when
  // available) as the canonical output so users can paste a sentence
  // like "Every 5 minutes" alongside the cron string.
  const registerOutput = useCallback(() => {
    if (!result || !result.ok) return null;
    return result.description ?? expression;
  }, [result, expression]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setExpression((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.cron.title')}
        description={t('utilities.tool.cron.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.cron.input.label')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.cron.input.label')}
            data-testid="cron-parser-input"
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            placeholder={t('utilities.tool.cron.input.placeholder') ?? undefined}
            spellCheck={false}
          />
        </div>
        <label className="grid gap-1 text-xs text-muted md:max-w-[12rem]">
          <FieldLabel>{t('utilities.tool.cron.nextCount.label')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.cron.nextCount.label')}
            data-testid="cron-parser-next-count"
            type="number"
            min={1}
            max={CRON_PARSER_MAX_NEXT}
            value={nextCount}
            onChange={(event) => handleCountChange(event.target.valueAsNumber)}
          />
        </label>
        <UtilityToolbar utilityId="cron-parser" primary={expression} run={runApply} />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.cron.schedule.label')}
        description={t('utilities.status.live')}
      >
        {result === null || isLoading ? (
          <StatusMessage message={t('utilities.tool.cron.loading')} />
        ) : !result.ok ? (
          <div className="grid gap-1">
            <StatusMessage
              message={t(result.errorKey)}
              tone={result.errorKey === 'utilities.tool.cron.error.empty' ? 'muted' : 'error'}
            />
            {result.message ? (
              <p
                className="font-mono text-[11px] leading-4 text-muted"
                data-testid="cron-parser-error-detail"
              >
                {result.message}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2">
              <FieldLabel>{t('utilities.tool.cron.description.label')}</FieldLabel>
              <div className="relative">
                <UtilityTextarea
                  aria-label={t('utilities.tool.cron.description.label')}
                  data-testid="cron-parser-description"
                  value={result.description}
                  readOnly
                  spellCheck={false}
                  className="pr-10 min-h-[4rem]"
                />
                <div className="absolute right-2 top-2">
                  <CopyButton
                    value={result.description}
                    testid="cron-parser-description-copy"
                    disabled={!result.description}
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <FieldLabel>{t('utilities.tool.cron.nextRuns.label')}</FieldLabel>
              {result.nextRuns.length === 0 ? (
                <StatusMessage message={t('utilities.tool.cron.nextRuns.empty')} />
              ) : (
                <ul
                  className="grid gap-1 rounded-[1.1rem] border border-border/80 bg-background/65 p-3"
                  data-testid="cron-parser-next-runs"
                >
                  {result.nextRuns.map((date, index) => (
                    <li
                      key={`${date.toISOString()}-${index}`}
                      className="font-mono text-xs text-foreground"
                      data-testid={`cron-parser-next-row-${index}`}
                    >
                      {formatCronRunTimestamp(date, i18n.language || 'en')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

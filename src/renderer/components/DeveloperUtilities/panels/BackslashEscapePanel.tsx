import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea } from '../panelPrimitives';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../CopyButton';
import { escapeWithPreset, unescapeWithPreset } from '../../../utils/backslashEscape';
import type { BackslashPreset, UnescapeReason } from '../../../utils/backslashEscape';

type BackslashMode = 'escape' | 'unescape';

const BACKSLASH_PRESETS: readonly BackslashPreset[] = [
  'javascript',
  'json',
  'python',
  'sql-mysql',
];

function reasonKey(reason: UnescapeReason): string {
  return `utilities.tool.backslashEscape.reason.${reason}`;
}

export function BackslashEscapePanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<BackslashMode>('escape');
  const [preset, setPreset] = useState<BackslashPreset>('javascript');
  const [input, setInput] = useState('Hello,\n"World"');

  const { output, errorKey, errorPosition } = useMemo<{
    output: string;
    errorKey: string | null;
    errorPosition: number | null;
  }>(() => {
    if (input === '') {
      return { output: '', errorKey: null, errorPosition: null };
    }
    if (mode === 'escape') {
      const result = escapeWithPreset(input, preset);
      return { output: result.output, errorKey: null, errorPosition: null };
    }
    const result = unescapeWithPreset(input, preset);
    if (result.ok) {
      return { output: result.output, errorKey: null, errorPosition: null };
    }
    return { output: '', errorKey: reasonKey(result.reason), errorPosition: result.position };
  }, [input, mode, preset]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.backslashEscape.title')}
        description={t('utilities.tool.backslashEscape.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.backslashEscape.modeLabel')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.backslashEscape.modeLabel')}
              data-testid="backslash-escape-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as BackslashMode)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="escape">
                {t('utilities.tool.backslashEscape.mode.escape')}
              </option>
              <option value="unescape">
                {t('utilities.tool.backslashEscape.mode.unescape')}
              </option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.backslashEscape.presetLabel')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.backslashEscape.presetLabel')}
              data-testid="backslash-escape-preset"
              value={preset}
              onChange={(event) => setPreset(event.target.value as BackslashPreset)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              {BACKSLASH_PRESETS.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`utilities.tool.backslashEscape.preset.${entry}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.backslashEscape.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.backslashEscape.input.label')}
            data-testid="backslash-escape-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('utilities.tool.backslashEscape.input.placeholder') ?? undefined}
            spellCheck={false}
          />
        </div>
        {preset === 'sql-mysql' ? (
          <StatusMessage
            tone="muted"
            message={t('utilities.tool.backslashEscape.sqlWildcardHint')}
          />
        ) : null}
      </PanelSection>

      <PanelSection
        title={t('utilities.field.output')}
        description={t('utilities.status.live')}
      >
        {errorKey ? (
          <StatusMessage
            tone="error"
            testid="backslash-escape-error"
            message={t('utilities.tool.backslashEscape.error.malformed', {
              reason: t(errorKey),
              position: errorPosition ?? 0,
            })}
          />
        ) : (
          <div className="relative">
            <UtilityTextarea
              aria-label={t('utilities.field.output')}
              data-testid="backslash-escape-output"
              value={output}
              readOnly
              spellCheck={false}
              className="pr-10"
            />
            <div className="absolute right-2 top-2">
              <CopyButton
                value={output}
                testid="backslash-escape-output-copy"
                disabled={!output}
              />
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

import { FieldLabel, PanelSection, StatusMessage, UtilityInput } from '../panelPrimitives';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../CopyButton';
import { buildCharset, generateRandomStrings } from '../../../utils/randomString';
import type { CharsetToggles } from '../../../utils/randomString';

const DEFAULT_RANDOM_STRING_TOGGLES: CharsetToggles = {
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: false,
  excludeAmbiguous: false,
};

function clampNumberInput(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  const rounded = Math.floor(raw);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function RandomStringPanel() {
  const { t } = useTranslation();
  const [length, setLength] = useState(32);
  const [count, setCount] = useState(5);
  const [toggles, setToggles] = useState<CharsetToggles>(DEFAULT_RANDOM_STRING_TOGGLES);
  const [values, setValues] = useState<string[]>([]);

  const charset = useMemo(() => buildCharset(toggles), [toggles]);
  const charsetEmpty = charset.length === 0;

  const handleGenerate = () => {
    const result = generateRandomStrings(length, count, charset);
    if (result.ok) {
      setValues(result.values);
    } else {
      setValues([]);
    }
  };

  const toggleLabel = (key: keyof CharsetToggles): string =>
    t(`utilities.tool.randomString.charset.${key}`);

  const setToggle = (key: keyof CharsetToggles, value: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.randomString.title')}
        description={t('utilities.tool.randomString.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.randomString.lengthLabel')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.randomString.lengthLabel')}
              data-testid="random-string-length"
              type="number"
              min={1}
              max={1024}
              value={length}
              onChange={(event) =>
                setLength(clampNumberInput(event.target.valueAsNumber, 1, 1024, 32))
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.randomString.countLabel')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.randomString.countLabel')}
              data-testid="random-string-count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(event) =>
                setCount(clampNumberInput(event.target.valueAsNumber, 1, 100, 5))
              }
            />
          </label>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted">
            {t('utilities.tool.randomString.charsetLabel')}
          </legend>
          <div className="grid gap-2 md:grid-cols-2">
            {(
              [
                'lowercase',
                'uppercase',
                'digits',
                'symbols',
                'excludeAmbiguous',
              ] as (keyof CharsetToggles)[]
            ).map((key) => (
              <label
                key={key}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  data-testid={`random-string-toggle-${key}`}
                  checked={toggles[key]}
                  onChange={(event) => setToggle(key, event.target.checked)}
                />
                <span>{toggleLabel(key)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {charsetEmpty ? (
          <StatusMessage
            tone="error"
            testid="random-string-error"
            message={t('utilities.tool.randomString.error.emptyCharset')}
          />
        ) : (
          <StatusMessage message={t('utilities.tool.randomString.secureHint')} />
        )}
        <button
          type="button"
          className="button-primary w-fit disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="random-string-generate"
          onClick={handleGenerate}
          disabled={charsetEmpty}
        >
          {t('utilities.tool.randomString.generate.action')}
        </button>
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.randomString.output.label')}
        description={t('utilities.status.live')}
      >
        {values.length === 0 ? (
          <StatusMessage message={t('utilities.tool.randomString.empty')} />
        ) : (
          <div className="grid gap-2">
            {values.map((value, index) => (
              <div
                key={`${index}-${value}`}
                data-testid={`random-string-value-${index}`}
                className="flex items-center justify-between gap-2 rounded-[1rem] border border-border/80 bg-background/70 px-3 py-2 font-mono text-sm text-foreground"
              >
                <span className="truncate">{value}</span>
                <CopyButton
                  value={value}
                  testid={`random-string-value-copy-${index}`}
                />
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </div>
  );
}

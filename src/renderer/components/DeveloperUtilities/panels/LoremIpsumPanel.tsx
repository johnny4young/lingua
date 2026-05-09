import { FieldLabel, PanelSection, StatusMessage, UtilityInput, UtilityTextarea } from '../panelPrimitives';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../CopyButton';
import { LOREM_IPSUM_MAX_PARAGRAPHS, LOREM_IPSUM_MAX_SENTENCES, LOREM_IPSUM_MAX_WORDS, generateLorem } from '../../../utils/loremIpsum';
import type { LoremIpsumUnit } from '../../../utils/loremIpsum';

function maxCountForUnit(unit: LoremIpsumUnit): number {
  if (unit === 'words') return LOREM_IPSUM_MAX_WORDS;
  if (unit === 'sentences') return LOREM_IPSUM_MAX_SENTENCES;
  return LOREM_IPSUM_MAX_PARAGRAPHS;
}

function defaultCountForUnit(unit: LoremIpsumUnit): number {
  if (unit === 'words') return 50;
  if (unit === 'sentences') return 5;
  return 3;
}

export function LoremIpsumPanel() {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<LoremIpsumUnit>('paragraphs');
  const [count, setCount] = useState<number>(3);
  const [startWithClassic, setStartWithClassic] = useState(true);
  const [output, setOutput] = useState('');

  const handleUnitChange = (next: LoremIpsumUnit) => {
    setUnit(next);
    setCount(defaultCountForUnit(next));
    setOutput('');
  };

  const handleCountChange = (next: number) => {
    if (!Number.isFinite(next)) {
      setCount(defaultCountForUnit(unit));
      return;
    }
    const clamped = Math.max(1, Math.min(maxCountForUnit(unit), Math.floor(next)));
    setCount(clamped);
  };

  const handleGenerate = () => {
    setOutput(generateLorem({ unit, count, startWithClassic }));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <PanelSection
        title={t('utilities.tool.loremIpsum.title')}
        description={t('utilities.tool.loremIpsum.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.loremIpsum.unitLabel')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.loremIpsum.unitLabel')}
              data-testid="lorem-ipsum-unit"
              value={unit}
              onChange={(event) => handleUnitChange(event.target.value as LoremIpsumUnit)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="words">{t('utilities.tool.loremIpsum.unit.words')}</option>
              <option value="sentences">
                {t('utilities.tool.loremIpsum.unit.sentences')}
              </option>
              <option value="paragraphs">
                {t('utilities.tool.loremIpsum.unit.paragraphs')}
              </option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.loremIpsum.countLabel')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.loremIpsum.countLabel')}
              data-testid="lorem-ipsum-count"
              type="number"
              min={1}
              max={maxCountForUnit(unit)}
              value={count}
              onChange={(event) => handleCountChange(event.target.valueAsNumber)}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            data-testid="lorem-ipsum-classic"
            checked={startWithClassic}
            onChange={(event) => setStartWithClassic(event.target.checked)}
          />
          <span>{t('utilities.tool.loremIpsum.startWithClassic')}</span>
        </label>
        <button
          type="button"
          className="button-primary w-fit"
          data-testid="lorem-ipsum-generate"
          onClick={handleGenerate}
        >
          {t('utilities.tool.loremIpsum.generate.action')}
        </button>
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.loremIpsum.output.label')}
        description={t('utilities.status.live')}
      >
        {output === '' ? (
          <StatusMessage message={t('utilities.tool.loremIpsum.empty')} />
        ) : (
          <div className="relative">
            <UtilityTextarea
              aria-label={t('utilities.tool.loremIpsum.output.label')}
              data-testid="lorem-ipsum-output"
              value={output}
              readOnly
              spellCheck={false}
              className="pr-10 min-h-[12rem]"
            />
            <div className="absolute right-2 top-2">
              <CopyButton value={output} testid="lorem-ipsum-output-copy" />
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

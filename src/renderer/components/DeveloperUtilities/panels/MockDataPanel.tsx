import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityInput,
  UtilityTextarea,
} from '../panelPrimitives';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import {
  MOCK_DATA_MAX_COUNT,
  generateMockData,
} from '../../../utils/mockData';
import type { MockDataset, MockFormat } from '../../../utils/mockData';

export function MockDataPanel() {
  const { t } = useTranslation();
  const [dataset, setDataset] = useState<MockDataset>('users');
  const [count, setCount] = useState<number>(10);
  const [format, setFormat] = useState<MockFormat>('json');
  const [seed, setSeed] = useState('');
  const [output, setOutput] = useState('');

  const handleCountChange = (next: number) => {
    if (!Number.isFinite(next)) {
      setCount(10);
      return;
    }
    setCount(Math.max(1, Math.min(MOCK_DATA_MAX_COUNT, Math.floor(next))));
  };

  const handleGenerate = () => {
    setOutput(generateMockData({ dataset, count, format, seed: seed.trim() }));
  };

  // Pure generator: no detect, no Apply button (mirrors Lorem Ipsum).
  const registerOutput = useCallback(() => output || null, [output]);
  useRegisterUtilityOutput(registerOutput);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.mockData.title')}
        description={t('utilities.tool.mockData.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.mockData.datasetLabel')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.mockData.datasetLabel')}
              data-testid="mock-data-dataset"
              value={dataset}
              onChange={event => setDataset(event.target.value as MockDataset)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="users">{t('utilities.tool.mockData.dataset.users')}</option>
              <option value="products">{t('utilities.tool.mockData.dataset.products')}</option>
              <option value="posts">{t('utilities.tool.mockData.dataset.posts')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.mockData.countLabel')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.mockData.countLabel')}
              data-testid="mock-data-count"
              type="number"
              min={1}
              max={MOCK_DATA_MAX_COUNT}
              value={count}
              onChange={event => handleCountChange(event.target.valueAsNumber)}
            />
          </label>
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.mockData.formatLabel')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.mockData.formatLabel')}
              data-testid="mock-data-format"
              value={format}
              onChange={event => setFormat(event.target.value as MockFormat)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="json">{t('utilities.tool.mockData.format.json')}</option>
              <option value="csv">{t('utilities.tool.mockData.format.csv')}</option>
              <option value="ndjson">{t('utilities.tool.mockData.format.ndjson')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.mockData.seedLabel')}</FieldLabel>
            <UtilityInput
              aria-label={t('utilities.tool.mockData.seedLabel')}
              data-testid="mock-data-seed"
              type="text"
              placeholder={t('utilities.tool.mockData.seedPlaceholder')}
              value={seed}
              onChange={event => setSeed(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="button-primary w-fit"
          data-testid="mock-data-generate"
          onClick={handleGenerate}
        >
          {t('utilities.tool.mockData.generate.action')}
        </button>
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.mockData.output.label')}
        description={t('utilities.status.live')}
      >
        {output === '' ? (
          <StatusMessage message={t('utilities.tool.mockData.empty')} />
        ) : (
          <div className="relative">
            <UtilityTextarea
              aria-label={t('utilities.tool.mockData.output.label')}
              data-testid="mock-data-output"
              value={output}
              readOnly
              spellCheck={false}
              className="pr-10 min-h-[18rem] font-mono"
            />
            <div className="absolute right-2 top-2">
              <CopyButton value={output} testid="mock-data-output-copy" />
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}

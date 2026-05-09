import { FieldLabel, PanelSection, StatusMessage, UtilityInput } from '../panelPrimitives';
import { Palette } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '../CopyButton';
import { analyzeColor } from '../../../utils/developerUtilities';

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

export function ColorUtilityPanel() {
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

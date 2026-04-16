import type { LayoutPreset } from '../../types';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { LAYOUT_PRESETS } from './settingsOptions';
import { Section } from './shared';

function LayoutIcon({ preset, active }: { preset: LayoutPreset; active: boolean }) {
  const main = active ? 'bg-primary' : 'bg-border-strong/75';
  const sub = active ? 'bg-primary/45' : 'bg-surface-strong';

  if (preset === 'horizontal') {
    return (
      <div className="flex h-12 w-full flex-col gap-1 overflow-hidden rounded-2xl">
        <div className={`flex-[2] rounded-xl ${main}`} />
        <div className={`flex-1 rounded-xl ${sub}`} />
      </div>
    );
  }

  if (preset === 'vertical') {
    return (
      <div className="flex h-12 w-full flex-row gap-1 overflow-hidden rounded-2xl">
        <div className={`flex-[2] rounded-xl ${main}`} />
        <div className={`flex-1 rounded-xl ${sub}`} />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-full overflow-hidden rounded-2xl">
      <div className={`flex-1 rounded-xl ${main}`} />
    </div>
  );
}

export function LayoutSection() {
  const layoutPreset = useSettingsStore((state) => state.layoutPreset);
  const setLayoutPreset = useSettingsStore((state) => state.setLayoutPreset);
  const { t } = useTranslation();

  return (
    <Section
      title={t('layout.title')}
      description={t('layout.description')}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {LAYOUT_PRESETS.map((preset) => {
          const selected = layoutPreset === preset.id;
          const label = t(preset.labelKey);
          const description = t(preset.descriptionKey);

          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setLayoutPreset(preset.id)}
              title={description}
              className={`flex flex-col gap-2.5 rounded-[1.15rem] border p-3.5 text-left transition-all ${
                selected
                  ? 'border-primary/35 bg-primary-soft'
                  : 'border-border/80 bg-background-elevated/72 hover:border-border-strong/90 hover:bg-surface/88'
              }`}
            >
              <LayoutIcon preset={preset.id} active={selected} />
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

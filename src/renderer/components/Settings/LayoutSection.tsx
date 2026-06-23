import type { LayoutPreset } from '../../types';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { LAYOUT_PRESETS } from './settingsOptions';
import { SettingsSection } from '../ui/SpecRow';

function LayoutIcon({ preset, active }: { preset: LayoutPreset; active: boolean }) {
  const main = active ? 'bg-accent' : 'bg-bg-panel-alt';
  const sub = active ? 'bg-accent/45' : 'bg-bg-panel';

  if (preset === 'horizontal') {
    return (
      <div className="flex h-12 w-full flex-col gap-1 overflow-hidden rounded-md">
        <div className={`flex-[2] rounded-md ${main}`} />
        <div className={`flex-1 rounded-md ${sub}`} />
      </div>
    );
  }

  if (preset === 'vertical') {
    return (
      <div className="flex h-12 w-full flex-row gap-1 overflow-hidden rounded-md">
        <div className={`flex-[2] rounded-md ${main}`} />
        <div className={`flex-1 rounded-md ${sub}`} />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-full overflow-hidden rounded-md">
      <div className={`flex-1 rounded-md ${main}`} />
    </div>
  );
}

export function LayoutSection() {
  const layoutPreset = useSettingsStore((state) => state.layoutPreset);
  const setLayoutPreset = useSettingsStore((state) => state.setLayoutPreset);
  const { t } = useTranslation();

  return (
    <SettingsSection eyebrow={t('layout.title')} description={t('layout.description')}>
      {/*
       * MOV.04 rhythm — the layout presets are selectable preview cards,
       * which the proto keeps as a bespoke custom grid (NOT SpecRows).
       * Only the surfacing is normalized to the section's inset/accent
       * tokens; selection logic and the LayoutIcon preview are preserved.
       */}
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
              className={`flex flex-col gap-2.5 rounded-lg border p-3.5 text-left transition-all ${
                selected
                  ? 'border-accent bg-primary-soft'
                  : 'border-border-subtle bg-bg-inset hover:border-border'
              }`}
            >
              <LayoutIcon preset={preset.id} active={selected} />
              <div>
                <p className="text-body-sm font-medium text-fg-base">{label}</p>
                <p className="mt-1 text-caption leading-5 text-fg-subtle">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

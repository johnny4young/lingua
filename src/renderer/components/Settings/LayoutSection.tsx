import type { LayoutPreset } from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';
import { LAYOUT_PRESETS } from './settingsOptions';
import { Section } from './shared';

function LayoutIcon({ preset, active }: { preset: LayoutPreset; active: boolean }) {
  const base = active ? 'bg-primary-400' : 'bg-gray-600';
  const dim = active ? 'bg-primary-800' : 'bg-gray-700';

  if (preset === 'horizontal') {
    return (
      <div className="flex h-8 w-full flex-col gap-0.5 overflow-hidden rounded">
        <div className={`flex-[2] rounded-sm ${base}`} />
        <div className={`flex-1 rounded-sm ${dim}`} />
      </div>
    );
  }

  if (preset === 'vertical') {
    return (
      <div className="flex h-8 w-full flex-row gap-0.5 overflow-hidden rounded">
        <div className={`flex-[2] rounded-sm ${base}`} />
        <div className={`flex-1 rounded-sm ${dim}`} />
      </div>
    );
  }

  return (
    <div className="flex h-8 w-full overflow-hidden rounded">
      <div className={`flex-1 rounded-sm ${base}`} />
    </div>
  );
}

export function LayoutSection() {
  const layoutPreset = useSettingsStore((state) => state.layoutPreset);
  const setLayoutPreset = useSettingsStore((state) => state.setLayoutPreset);

  return (
    <Section title="Layout">
      <div className="grid grid-cols-3 gap-2">
        {LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setLayoutPreset(preset.id)}
            title={preset.description}
            className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
              layoutPreset === preset.id
                ? 'border-primary-500 bg-primary-500/10'
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <LayoutIcon preset={preset.id} active={layoutPreset === preset.id} />
            <span
              className={`text-xs font-medium leading-tight ${
                layoutPreset === preset.id ? 'text-primary-400' : 'text-gray-400'
              }`}
            >
              {preset.label}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

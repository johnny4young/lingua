import { MoonStar, SunMedium } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { Section } from './shared';

const APP_THEMES = [
  {
    id: 'dark' as const,
    label: 'Dark',
    description: 'High-contrast graphite shell for focused coding sessions.',
    icon: MoonStar,
    previewClass: 'from-[#10141c] via-[#1b2130] to-[#11161f]',
  },
  {
    id: 'light' as const,
    label: 'Light',
    description: 'Warm paper workspace with calmer contrast and stronger daylight readability.',
    icon: SunMedium,
    previewClass: 'from-[#f6f1e9] via-[#fbf7f1] to-[#ece5da]',
  },
];

export function AppearanceSection() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return (
    <Section
      title="Appearance"
      description="Lingua supports a dark-first shell and a refined light mode without changing your editor runtime settings."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {APP_THEMES.map((option) => {
          const Icon = option.icon;
          const selected = theme === option.id;

          return (
            <button
              key={option.id}
              onClick={() => setTheme(option.id)}
              className={`rounded-[1.45rem] border p-4 text-left transition-all ${
                selected
                  ? 'border-primary/35 bg-primary-soft shadow-[0_16px_55px_rgba(77,54,156,0.16)]'
                  : 'border-border/80 bg-background-elevated/72 hover:border-border-strong/90 hover:bg-surface/88'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-semibold tracking-[-0.03em] text-foreground">
                    {option.label}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">{option.description}</p>
                </div>
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${
                    selected ? 'bg-primary text-primary-foreground' : 'bg-surface-strong text-muted'
                  }`}
                >
                  <Icon size={16} />
                </div>
              </div>

              <div
                className={`mt-4 h-20 rounded-[1.2rem] border border-white/6 bg-gradient-to-br ${option.previewClass} p-3`}
              >
                <div className="flex h-full gap-2">
                  <div className="w-[28%] rounded-2xl border border-white/10 bg-black/10" />
                  <div className="flex-1 rounded-2xl border border-white/10 bg-black/6" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

import { useSettingsStore } from '../../stores/settingsStore';
import { Row, Section } from './shared';

export function AppearanceSection() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return (
    <Section title="Appearance">
      <Row label="App theme">
        <div className="flex gap-2">
          {(['dark', 'light'] as const).map((themeOption) => (
            <button
              key={themeOption}
              onClick={() => setTheme(themeOption)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                theme === themeOption
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

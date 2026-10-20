import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n';
import { PerLanguageDefaultsSection } from '@/components/Settings/PerLanguageDefaultsSection';
import { useSettingsStore } from '@/stores/settingsStore';

const initialSettings = useSettingsStore.getState();

describe('Per-language defaults matrix', () => {
  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('has one row per language and a dash where the language has no such setting', () => {
    render(<PerLanguageDefaultsSection />);
    const table = screen.getByRole('table', { name: 'Per-language defaults' });
    // Every row, the header included, fills the four grid columns.
    for (const row of within(table).getAllByRole('row')) {
      for (const cell of row.children) expect(cell.className).not.toMatch(/\bsr-only\b/);
      expect(row.children).toHaveLength(4);
    }
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getByRole('rowheader').textContent)).toEqual([
      'JavaScript',
      'TypeScript',
      'Python',
      'Go',
      'Ruby',
    ]);

    // Go and Ruby only carry a timeout; workflow and auto-log read as a dash.
    for (const [row, language] of [
      [rows[3]!, 'go'],
      [rows[4]!, 'ruby'],
    ] as const) {
      expect(within(row).queryByTestId(`settings-workflow-mode-default-${language}`)).toBeNull();
      expect(within(row).queryByTestId(`settings-auto-log-default-${language}`)).toBeNull();
      expect(within(row).getAllByText('—')).toHaveLength(2);
      expect(within(row).getByTestId(`settings-runtime-timeout-preset-${language}`)).toBeTruthy();
    }
  });

  it('writes the same stores as the stacked rows did', () => {
    render(<PerLanguageDefaultsSection />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Default workflow · Python' }), {
      target: { value: 'run' },
    });
    expect(useSettingsStore.getState().workflowModeDefaultsByLanguage.python).toBe('run');

    const before = useSettingsStore.getState().scratchpadAutoLogByLanguage.typescript === true;
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-log · TypeScript' }));
    expect(useSettingsStore.getState().scratchpadAutoLogByLanguage.typescript === true).toBe(
      !before
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Execution timeout · Go' }), {
      target: { value: 'long' },
    });
    expect(useSettingsStore.getState().runtimeTimeoutPresetByLanguage.go).toBe('long');
  });

  it('localizes the headers and labels in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<PerLanguageDefaultsSection />);
    expect(screen.getByRole('table', { name: 'Valores por lenguaje' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Tiempo límite' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Tiempo límite · Go' })).toBeTruthy();
  });
});

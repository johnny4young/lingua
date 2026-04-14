import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { AppearanceSection } from '../../src/renderer/components/Settings/AppearanceSection';
import { initI18n } from '../../src/renderer/i18n';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

describe('AppearanceSection', () => {
  const initialState = useSettingsStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialState, true);
    initI18n('en');
    await i18next.changeLanguage('en');

    Object.defineProperty(window, 'lingua', {
      value: {
        getSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      },
      configurable: true,
      writable: true,
    });
  });

  it('renders localized appearance copy in Spanish', async () => {
    await i18next.changeLanguage('es');

    render(<AppearanceSection />);

    expect(screen.getByText('Apariencia')).toBeTruthy();
    expect(
      screen.getByText(
        'Lingua ofrece un shell orientado al modo oscuro y un modo claro refinado sin cambiar la configuración del editor ni del entorno.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Oscuro')).toBeTruthy();
    expect(screen.getByText('Claro')).toBeTruthy();
  });

  it('updates the persisted language when the selector changes', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.selectOptions(screen.getByRole('combobox'), 'es');

    await waitFor(() => {
      expect(useSettingsStore.getState().language).toBe('es');
      expect(i18next.language).toBe('es');
    });
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';

describe('EditorSection — Browser preview auto-refresh ', () => {
  const initialSettings = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
    await i18next.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
    await i18next.changeLanguage('en');
  });

  it('renders 300 ms by default and persists Off / 1 second selections', async () => {
    const user = userEvent.setup();
    render(<EditorSection />);
    const select = screen.getByTestId(
      'settings-browser-preview-auto-refresh'
    );

    expect((select as HTMLSelectElement).value).toBe('300');
    expect(select.querySelectorAll('option')).toHaveLength(3);

    await user.selectOptions(select, '0');
    expect(
      useSettingsStore.getState().browserPreviewRefreshIntervalMs
    ).toBe(0);

    await user.selectOptions(select, '1000');
    expect(
      useSettingsStore.getState().browserPreviewRefreshIntervalMs
    ).toBe(1_000);
  });

  it('renders neutral Spanish copy', async () => {
    await i18next.changeLanguage('es');
    render(<EditorSection />);

    expect(
      screen.getByRole('combobox', {
        name: /Actualización automática de la vista previa/i,
      })
    ).toBeTruthy();
    expect(screen.getByRole('option', { name: /Desactivada/i })).toBeTruthy();
  });
});

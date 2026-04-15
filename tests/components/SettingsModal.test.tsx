import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { SettingsModal } from '../../src/renderer/components/Settings/SettingsModal';
import { initI18n } from '../../src/renderer/i18n';
import { usePluginStore } from '../../src/renderer/stores/pluginStore';
import { useUpdateStore } from '../../src/renderer/stores/updateStore';

describe('SettingsModal', () => {
  const initialPluginState = usePluginStore.getState();
  const initialUpdateState = useUpdateStore.getState();

  beforeEach(async () => {
    usePluginStore.setState(initialPluginState, true);
    useUpdateStore.setState(initialUpdateState, true);
    initI18n('en');
    await i18next.changeLanguage('es');
  });

  it('renders the remaining settings sections with localized copy', () => {
    render(<SettingsModal onClose={() => {}} />);

    expect(screen.getByText('Diseño')).toBeTruthy();
    expect(screen.getByText('División horizontal')).toBeTruthy();
    expect(screen.getByText('Tema del editor')).toBeTruthy();
    expect(screen.getByText('Actualizaciones')).toBeTruthy();
    expect(screen.getByText('No disponible')).toBeTruthy();
    expect(screen.getByText('Plugins')).toBeTruthy();
    expect(screen.getByText('Directorio local de plugins')).toBeTruthy();
    expect(screen.getByText('No hay plugins locales instalados.')).toBeTruthy();
    expect(screen.getByTitle('Cerrar configuración')).toBeTruthy();
  });

  it('re-translates the web unavailable updates message after changing locale', () => {
    window.lingua = {
      ...window.lingua,
      platform: 'web',
    } as LinguaAPI;

    useUpdateStore.setState({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: 'Automatic updates are not available in the web version.',
    });

    render(<SettingsModal onClose={() => {}} />);

    expect(
      screen.getByText('Las actualizaciones automáticas no están disponibles en la versión web.')
    ).toBeTruthy();
  });
});

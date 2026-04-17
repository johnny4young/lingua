import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { SettingsModal } from '../../src/renderer/components/Settings/SettingsModal';
import { initI18n } from '../../src/renderer/i18n';
import { usePluginStore } from '../../src/renderer/stores/pluginStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUpdateStore } from '../../src/renderer/stores/updateStore';

describe('SettingsModal', () => {
  const initialPluginState = usePluginStore.getState();
  const initialUpdateState = useUpdateStore.getState();
  const initialSettingsState = useSettingsStore.getState();

  beforeEach(async () => {
    usePluginStore.setState(initialPluginState, true);
    useUpdateStore.setState(initialUpdateState, true);
    useSettingsStore.setState(initialSettingsState, true);
    initI18n('en');
    await i18next.changeLanguage('es');
    window.lingua = {
      ...window.lingua,
      platform: 'darwin',
      getAppInfo: vi.fn().mockResolvedValue({
        productName: 'Lingua',
        version: '0.1.0',
        buildDate: '2026-04-16T01:23:45.000Z',
        licenseType: 'MIT',
        repositoryUrl: 'https://github.com/johnny4young/lingua',
        websiteUrl: null,
        licenseUrl: 'https://github.com/johnny4young/lingua/blob/main/LICENSE',
      }),
      openExternal: vi.fn().mockResolvedValue(true),
    } as LinguaAPI;
  });

  it('renders the remaining settings sections with localized copy', async () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );

    expect(screen.getByText('Acerca de')).toBeTruthy();
    expect(await screen.findByText('MIT')).toBeTruthy();
    expect(screen.getByText('Iniciar tour guiado')).toBeTruthy();
    expect(screen.getByText('Novedades')).toBeTruthy();
    expect(screen.getByText('Diseño')).toBeTruthy();
    expect(screen.getByText('División horizontal')).toBeTruthy();
    expect(screen.getByText('Tema del editor')).toBeTruthy();
    expect(screen.getByText('Actualizaciones')).toBeTruthy();
    expect(screen.getByText('No disponible')).toBeTruthy();
    expect(screen.getByText('Plugins')).toBeTruthy();
    expect(screen.getByText('Directorio local de plugins')).toBeTruthy();
    expect(screen.getByText('No hay plugins locales instalados.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar configuración' })).toBeTruthy();
  }, 10000);

  it('re-translates the web unavailable updates message after changing locale', async () => {
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

    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );
    expect(await screen.findByText('MIT')).toBeTruthy();

    expect(
      screen.getByText('Las actualizaciones automáticas no están disponibles en la versión web.')
    ).toBeTruthy();
  }, 10000);

  it('disables the ligatures toggle and shows the unavailable hint for non-ligature fonts', async () => {
    useSettingsStore.setState({
      fontFamily: 'Menlo, monospace',
      fontLigatures: true,
    });

    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );

    expect(await screen.findByText('MIT')).toBeTruthy();
    expect(
      screen.getByText('La fuente seleccionada no incluye ligaduras de programación.')
    ).toBeTruthy();
    expect(screen.getAllByRole('switch').some((element) => element.hasAttribute('disabled'))).toBe(
      true
    );
  }, 10000);
});

import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders the remaining settings sections with localized copy across the five tabs', async () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );

    // internal — sections are now grouped under rail tabs. Walk through
    // each tab and assert its contents instead of expecting everything
    // on the default tab. Default tab is `general` (About + Updates).
    expect(screen.getByText('Acerca de')).toBeTruthy();
    expect(await screen.findByText('MIT')).toBeTruthy();
    expect(screen.getByText('Iniciar tour guiado')).toBeTruthy();
    expect(screen.getByText('Novedades')).toBeTruthy();
    expect(screen.getByText('Actualizaciones')).toBeTruthy();
    expect(screen.getByText('No disponible')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar configuración' })).toBeTruthy();
    expect(document.getElementById('settings-modal-title')?.className).toContain(
      'sr-only'
    );

    // accessibility pass — rail tabs carry the .settings-rail-row class, which now
    // bakes in the shared .focus-ring (the ring itself is verified live).
    expect(
      screen.getByTestId('settings-tab-appearance').className
    ).toContain('settings-rail-row');

    // Switch to Apariencia → Diseño (Layout) lives here.
    const appearanceTab = screen.getByTestId('settings-tab-appearance');
    fireEvent.click(appearanceTab);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      appearanceTab.id
    );
    expect(screen.getByText('Diseño')).toBeTruthy();
    expect(screen.getByText('División horizontal')).toBeTruthy();
    const themePackSelect = screen.getByTestId('theme-pack-select');
    fireEvent.keyDown(themePackSelect, { key: 'ArrowRight' });
    expect(appearanceTab.getAttribute('aria-selected')).toBe('true');
    // internal — v2 nav uses ⌘N (metaKey + digit) instead of arrow keys.
    fireEvent.keyDown(window, { key: '3', metaKey: true });
    expect(screen.getByTestId('settings-tab-editor').getAttribute('aria-selected')).toBe('true');

    // Switch to Editor → editor theme lives here.
    fireEvent.click(screen.getByTestId('settings-tab-editor'));
    expect(screen.getByText('Tema del editor')).toBeTruthy();
    // internal — Plugins moved to its own rail entry under Advanced.
    fireEvent.click(screen.getByTestId('settings-tab-plugins'));
    expect(screen.getAllByText('Plugins').length).toBeGreaterThan(0);
    expect(screen.getByText('Directorio local de plugins')).toBeTruthy();
    expect(screen.getByText('No hay plugins locales instalados.')).toBeTruthy();
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

  // implementation — the standalone ligatures toggle was removed; ligatures
  // now auto-render when the active font stack supports them. The
  // "disables ligatures for non-ligature fonts" case no longer
  // applies (the font preview row still shows the visual state).

  it('maps the decoupled rail shortcuts to the intended tabs', async () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );

    expect(await screen.findByText('MIT')).toBeTruthy();

    // internal inserted Languages visually between Editor and Environment,
    // while preserving Environment on Cmd+4 and assigning Languages to Cmd+8.
    fireEvent.keyDown(window, { key: '8', metaKey: true });
    expect(screen.getByTestId('settings-tab-languages').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByText('Scorecard de soporte de lenguajes')).toBeTruthy();

    fireEvent.keyDown(window, { key: '4', metaKey: true });
    expect(screen.getByTestId('settings-tab-environment').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByText('Variables de entorno')).toBeTruthy();

    fireEvent.keyDown(window, { key: '9', metaKey: true });
    expect(screen.getByTestId('settings-tab-privacy').getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByText('Privacidad y confianza')).toBeTruthy();
    expect(screen.getByText('Vista previa de redacción')).toBeTruthy();
    expect(screen.getByText('Run Ledger (historial local de ejecuciones)')).toBeTruthy();
  }, 10000);

  it('preserves rail filter dimming and keyboard focus navigation', () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );

    fireEvent.change(screen.getByTestId('settings-filter-input'), {
      target: { value: 'plugin' },
    });
    expect(screen.getByTestId('settings-tab-plugins').getAttribute('data-dim')).toBe(
      'false'
    );
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('data-dim')).toBe(
      'true'
    );

    const general = screen.getByTestId('settings-tab-general');
    const appearance = screen.getByTestId('settings-tab-appearance');
    general.focus();
    fireEvent.keyDown(general, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(appearance);

    fireEvent.keyDown(appearance, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('settings-tab-recovery'));
  });

  it('sets aria-controls only on the active tab so inactive tabs never reference an unmounted panel', () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onOpenWhatsNew={() => {}}
        onStartGuidedTour={() => {}}
      />
    );

    // Only the active tabpanel is mounted; the active tab must point at it,
    // and inactive tabs must not carry a dangling aria-controls reference.
    const general = screen.getByTestId('settings-tab-general');
    const appearance = screen.getByTestId('settings-tab-appearance');
    const panelId = screen.getByRole('tabpanel').getAttribute('id');

    expect(general.getAttribute('aria-controls')).toBe(panelId);
    expect(document.getElementById(panelId ?? '')).not.toBeNull();
    expect(appearance.getAttribute('aria-controls')).toBeNull();

    // The reference follows the selection when the active tab changes.
    fireEvent.click(appearance);
    const nextPanelId = screen.getByRole('tabpanel').getAttribute('id');
    expect(appearance.getAttribute('aria-controls')).toBe(nextPanelId);
    expect(general.getAttribute('aria-controls')).toBeNull();
  });
});

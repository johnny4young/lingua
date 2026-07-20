import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { PluginsSection } from '../../../src/renderer/components/Settings/PluginsSection';
import { usePluginStore } from '../../../src/renderer/stores/pluginStore';
import { pluginRegistry } from '../../../src/renderer/plugins';

/**
 * internal — capa 3 cobertura UI.
 *
 * Cada caso fija el estado de `usePluginStore` con un fixture y
 * verifica que el badge + diagnóstico se rendericen correctamente.
 * No depende de IPC ni de disco — el render es contra el store.
 */

interface PluginFixture {
  pluginId: string;
  manifestPath: string;
  installDirectory: string;
  apiVersion: number | null;
  enabled: boolean;
  status: PluginInstallStatus;
  message: string;
  diagnostic?: PluginDiagnostic;
  displayName: string;
  language?: string;
  managedByApp: boolean;
}

function fixture(overrides: Partial<PluginFixture> & { status: PluginInstallStatus }): PluginFixture {
  const id = overrides.pluginId ?? 'lua';
  return {
    pluginId: id,
    manifestPath: `/tmp/lingua/plugins/${id}/plugin.json`,
    installDirectory: `/tmp/lingua/plugins/${id}`,
    apiVersion: 1,
    enabled: overrides.enabled ?? true,
    message: 'Plugin manifest is valid.',
    displayName: id,
    managedByApp: false,
    ...overrides,
  };
}

function setStore(plugins: PluginFixture[], installDirectory = '/tmp/lingua/plugins'): void {
  usePluginStore.setState({
    initialized: true,
    installDirectory,
    plugins,
  });
}

describe('PluginsSection', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    pluginRegistry.unregister('lua');
    usePluginStore.setState({ initialized: false, installDirectory: null, plugins: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('empty state', () => {
    it('renders the empty-state copy and the refresh button', () => {
      setStore([]);
      render(<PluginsSection />);
      expect(screen.getByText('No local plugins are installed.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    });
  });

  describe('per-status rendering', () => {
    it('renders a loaded plugin with the Loaded badge', () => {
      setStore([
        fixture({
          status: 'loaded',
          displayName: 'Lua',
          message: 'Plugin manifest is valid.',
          managedByApp: true,
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Loaded')).toBeTruthy();
      expect(screen.getByText('Lua')).toBeTruthy();
      expect(screen.getByText('Plugin manifest is valid.')).toBeTruthy();
    });

    it('renders a disabled plugin with the Disabled badge and the disabled diagnostic', () => {
      setStore([
        fixture({
          status: 'disabled',
          enabled: false,
          message: 'Plugin is installed but disabled in its manifest.',
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Disabled')).toBeTruthy();
      expect(screen.getByText('Plugin is installed but disabled in its manifest.')).toBeTruthy();
    });

    it('renders an invalid plugin (unsafe pluginId) with the Invalid badge and the unsafe-id diagnostic', () => {
      setStore([
        fixture({
          status: 'invalid',
          pluginId: '../traversal',
          enabled: false,
          message: 'Plugin id "../traversal" is not a safe identifier (use a-z, 0-9, hyphen).',
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Invalid')).toBeTruthy();
      // The diagnostic message contains the unsafe id verbatim.
      expect(
        screen.getByText(/Plugin id "\.\.\/traversal" is not a safe identifier/),
      ).toBeTruthy();
    });

    it('renders an invalid plugin (unknown fields) with the unknown-fields diagnostic', () => {
      setStore([
        fixture({
          status: 'invalid',
          enabled: false,
          message: 'Manifest contains unknown fields: executable, secret.',
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Invalid')).toBeTruthy();
      expect(
        screen.getByText('Manifest contains unknown fields: executable, secret.'),
      ).toBeTruthy();
    });

    it('renders an incompatible plugin (apiVersion mismatch) with the apiVersion diagnostic', () => {
      setStore([
        fixture({
          status: 'incompatible',
          message: 'Plugin API version 2 is not supported. Expected 1.',
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Incompatible')).toBeTruthy();
      expect(
        screen.getByText('Plugin API version 2 is not supported. Expected 1.'),
      ).toBeTruthy();
    });

    it('renders an incompatible plugin (version range) with the version-range diagnostic', () => {
      setStore([
        fixture({
          status: 'incompatible',
          message: 'Plugin requires app version >= 99.0.0.',
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Incompatible')).toBeTruthy();
      expect(screen.getByText('Plugin requires app version >= 99.0.0.')).toBeTruthy();
    });

    it('renders an unknown plugin with the new Unknown badge and the unknown diagnostic (internal NEW)', () => {
      setStore([
        fixture({
          status: 'unknown',
          pluginId: 'ruby',
          message: 'This build does not include a plugin named "ruby".',
        }),
      ]);
      render(<PluginsSection />);
      // The new badge is distinct from `unavailable` — assert both
      // the presence of "Unknown" and the absence of "Unavailable".
      expect(screen.getByText('Unknown')).toBeTruthy();
      expect(screen.queryByText('Unavailable')).toBeNull();
      expect(
        screen.getByText('This build does not include a plugin named "ruby".'),
      ).toBeTruthy();
    });

    it('renders an unavailable plugin (defensive runtime-mismatch fallback) with the Unavailable badge', () => {
      setStore([
        fixture({
          status: 'unavailable',
          pluginId: 'pruned-runtime',
          message:
            'Plugin "pruned-runtime" is installed, but this build does not provide a matching bundled runtime.',
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Unavailable')).toBeTruthy();
      expect(screen.queryByText('Unknown')).toBeNull();
    });

    it('falls back to a stable badge when IPC returns an unexpected status', () => {
      setStore([
        fixture({
          message: 'Main returned an unexpected status.',
          // Runtime IPC is not type-checked; keep the renderer from
          // exposing raw i18n keys if a future main path drifts.
          status: 'blocked' as PluginInstallStatus,
        }),
      ]);
      render(<PluginsSection />);
      expect(screen.getByText('Unrecognized')).toBeTruthy();
      expect(screen.queryByText('plugins.state.blocked')).toBeNull();
    });
  });

  describe('locale flip', () => {
    it('translates every status badge into Spanish (tuteo) on language change', async () => {
      setStore([
        fixture({ pluginId: 'lua', status: 'loaded', displayName: 'Lua' }),
        fixture({ pluginId: 'lua-disabled', status: 'disabled', enabled: false }),
        fixture({ pluginId: 'broken', status: 'invalid' }),
        fixture({ pluginId: 'old', status: 'incompatible' }),
        fixture({ pluginId: 'pruned', status: 'unavailable' }),
        fixture({ pluginId: 'ruby', status: 'unknown' }),
      ]);

      await i18next.changeLanguage('es');
      render(<PluginsSection />);

      expect(screen.getByText('Cargado')).toBeTruthy();
      expect(screen.getByText('Deshabilitado')).toBeTruthy();
      expect(screen.getByText('Inválido')).toBeTruthy();
      expect(screen.getByText('Incompatible')).toBeTruthy();
      expect(screen.getByText('No disponible')).toBeTruthy();
      // Tuteo neutral LatAm — `Desconocido` no `Unknown`.
      expect(screen.getByText('Desconocido')).toBeTruthy();
    });

    it('translates the empty-state and refresh button on language change', async () => {
      setStore([]);
      await i18next.changeLanguage('es');
      render(<PluginsSection />);
      expect(screen.getByText('No hay plugins locales instalados.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy();
    });

    it('translates structured diagnostics instead of rendering main-process English', async () => {
      setStore([
        fixture({
          pluginId: 'ruby',
          status: 'unknown',
          message: 'This build does not include a plugin named "ruby".',
          diagnostic: { key: 'unknown', params: { pluginId: 'ruby' } },
        }),
        fixture({
          pluginId: 'lua',
          status: 'invalid',
          enabled: false,
          message: 'Manifest contains unknown fields: executable, secret.',
          diagnostic: { key: 'unknownFields', params: { fields: 'executable, secret' } },
        }),
      ]);

      await i18next.changeLanguage('es');
      render(<PluginsSection />);

      expect(screen.getByText("Esta versión no incluye un plugin llamado 'ruby'.")).toBeTruthy();
      expect(
        screen.getByText('El manifiesto contiene campos desconocidos: executable, secret.'),
      ).toBeTruthy();
      expect(screen.queryByText('This build does not include a plugin named "ruby".')).toBeNull();
      expect(screen.queryByText('Manifest contains unknown fields: executable, secret.')).toBeNull();
    });
  });

  describe('container constraint', () => {
    it('keeps long pluginIds and manifestPaths inside their flex container with break-all wrapping', () => {
      const longId = 'lua';
      const longManifestPath =
        '/Users/someone-with-a-very-long-username/Library/Application Support/Lingua/plugins/lua/plugin.json';

      setStore([
        fixture({
          pluginId: longId,
          status: 'loaded',
          displayName: 'Lua',
          manifestPath: longManifestPath,
          installDirectory: longManifestPath.replace(/\/plugin\.json$/, ''),
        }),
      ]);

      const { container } = render(
        <div style={{ width: 320 }}>
          <PluginsSection />
        </div>,
      );

      const pathNode = screen.getByText(longManifestPath);
      // The component wraps long paths via `break-all`. Verify the
      // class is on the rendered node so future style refactors don't
      // silently lose the wrap behavior.
      expect(pathNode.className).toContain('break-all');

      // Sanity check — the container is the wrapper we passed in;
      // the section should not produce horizontal scroll, but jsdom
      // doesn't compute layout, so we assert the structural anchor:
      // the section root is rendered.
      expect(container.firstElementChild).toBeTruthy();
    });
  });

  describe('refresh action', () => {
    it('invokes the store refresh handler when the button is clicked', async () => {
      setStore([]);
      const refreshSpy = vi.fn().mockResolvedValue(undefined);
      usePluginStore.setState({ refresh: refreshSpy });
      const user = userEvent.setup();

      render(<PluginsSection />);
      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      expect(refreshSpy).toHaveBeenCalledOnce();
    });
  });
});

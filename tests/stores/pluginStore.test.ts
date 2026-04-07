import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginRegistry } from '@/plugins';
import { usePluginStore } from '@/stores/pluginStore';

const mockGetInstallDirectory = vi.fn();
const mockList = vi.fn();

describe('pluginStore', () => {
  beforeEach(() => {
    pluginRegistry.unregister('lua');
    usePluginStore.setState({
      initialized: false,
      installDirectory: null,
      plugins: [],
    });

    mockGetInstallDirectory.mockReset();
    mockList.mockReset();

    const currentRunlang = (window.runlang ?? {}) as Partial<RunLangAPI>;

    window.runlang = {
      ...currentRunlang,
      plugins: {
        getInstallDirectory: mockGetInstallDirectory,
        list: mockList,
      },
    } as RunLangAPI;
  });

  it('loads installed plugins and registers bundled runtimes', async () => {
    mockGetInstallDirectory.mockResolvedValue('/tmp/runlang/plugins');
    mockList.mockResolvedValue([
      {
        pluginId: 'lua',
        manifestPath: '/tmp/runlang/plugins/lua/plugin.json',
        installDirectory: '/tmp/runlang/plugins/lua',
        apiVersion: 1,
        enabled: true,
        status: 'loaded',
        message: 'Plugin manifest is valid.',
      },
    ] satisfies InstalledPluginRecord[]);

    await usePluginStore.getState().initialize();

    const state = usePluginStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.installDirectory).toBe('/tmp/runlang/plugins');
    expect(state.plugins[0]?.displayName).toBe('Lua');
    expect(state.plugins[0]?.managedByApp).toBe(true);
    expect(pluginRegistry.get('lua')).toBeDefined();
  });

  it('marks installed manifests without bundled runtimes as unavailable', async () => {
    mockGetInstallDirectory.mockResolvedValue('/tmp/runlang/plugins');
    mockList.mockResolvedValue([
      {
        pluginId: 'ruby',
        manifestPath: '/tmp/runlang/plugins/ruby/plugin.json',
        installDirectory: '/tmp/runlang/plugins/ruby',
        apiVersion: 1,
        enabled: true,
        status: 'loaded',
        message: 'Plugin manifest is valid.',
      },
    ] satisfies InstalledPluginRecord[]);

    await usePluginStore.getState().initialize();

    const state = usePluginStore.getState();
    expect(state.plugins[0]?.status).toBe('unavailable');
    expect(state.plugins[0]?.managedByApp).toBe(false);
    expect(pluginRegistry.get('ruby')).toBeUndefined();
  });

  it('unregisters previously managed plugins during refresh', async () => {
    mockGetInstallDirectory.mockResolvedValue('/tmp/runlang/plugins');
    mockList
      .mockResolvedValueOnce([
        {
          pluginId: 'lua',
          manifestPath: '/tmp/runlang/plugins/lua/plugin.json',
          installDirectory: '/tmp/runlang/plugins/lua',
          apiVersion: 1,
          enabled: true,
          status: 'loaded',
          message: 'Plugin manifest is valid.',
        },
      ] satisfies InstalledPluginRecord[])
      .mockResolvedValueOnce([] satisfies InstalledPluginRecord[]);

    await usePluginStore.getState().initialize();
    expect(pluginRegistry.get('lua')).toBeDefined();

    await usePluginStore.getState().refresh();

    expect(usePluginStore.getState().plugins).toHaveLength(0);
    expect(pluginRegistry.get('lua')).toBeUndefined();
  });
});

import { create } from 'zustand';
import { pluginRegistry } from '../plugins';
import { getBundledPlugin } from '../plugins/catalog';

interface PluginStoreRecord extends InstalledPluginRecord {
  displayName: string;
  language?: string;
  managedByApp: boolean;
}

interface PluginStoreState {
  initialized: boolean;
  installDirectory: string | null;
  plugins: PluginStoreRecord[];
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
}

const managedPluginIds = new Set<string>();

function unregisterManagedPlugins(): void {
  for (const pluginId of managedPluginIds) {
    pluginRegistry.unregister(pluginId);
  }
  managedPluginIds.clear();
}

function normalizePluginRecord(record: InstalledPluginRecord): PluginStoreRecord {
  const bundledPlugin = getBundledPlugin(record.pluginId);

  if (record.status === 'loaded' && !bundledPlugin) {
    return {
      ...record,
      status: 'unavailable',
      message: `Plugin "${record.pluginId}" is installed, but this build does not provide a matching bundled runtime.`,
      displayName: record.pluginId,
      managedByApp: false,
    };
  }

  if (record.status === 'loaded' && bundledPlugin) {
    if (!pluginRegistry.get(bundledPlugin.id)) {
      pluginRegistry.register(bundledPlugin);
      managedPluginIds.add(bundledPlugin.id);
    }

    return {
      ...record,
      displayName: bundledPlugin.name,
      language: bundledPlugin.language,
      managedByApp: true,
    };
  }

  return {
    ...record,
    displayName: bundledPlugin?.name ?? record.pluginId,
    language: bundledPlugin?.language,
    managedByApp: false,
  };
}

async function loadPluginsIntoState(): Promise<{
  installDirectory: string | null;
  plugins: PluginStoreRecord[];
}> {
  const installDirectory = await window.runlang.plugins.getInstallDirectory();
  const installed = await window.runlang.plugins.list();

  unregisterManagedPlugins();

  return {
    installDirectory,
    plugins: installed.map(normalizePluginRecord),
  };
}

export const usePluginStore = create<PluginStoreState>((set) => ({
  initialized: false,
  installDirectory: null,
  plugins: [],

  initialize: async () => {
    const next = await loadPluginsIntoState();
    set({ ...next, initialized: true });
  },

  refresh: async () => {
    const next = await loadPluginsIntoState();
    set(next);
  },
}));

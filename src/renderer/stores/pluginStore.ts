import { create } from 'zustand';
import { pluginRegistry } from '../plugins';
import { hasBundledPlugin, loadBundledPlugin } from '@/plugins/catalog';

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

async function normalizePluginRecord(record: InstalledPluginRecord): Promise<PluginStoreRecord> {
  // RL-084 — main now emits `unknown` directly when a manifest's
  // pluginId is not in the bundled allowlist. The renderer used to
  // re-map `loaded` → `unavailable` for that case; that mapping is
  // gone. The remaining defensive path catches the unlikely scenario
  // where main returns `loaded` but the renderer can't find a loader
  // (e.g., a pruned build that lost a runtime). Keep that path as
  // `unavailable` so the user sees a recoverable diagnostic instead
  // of a silent no-op.
  if (record.status === 'loaded' && !hasBundledPlugin(record.pluginId)) {
    return {
      ...record,
      status: 'unavailable',
      message: `Plugin "${record.pluginId}" is installed, but this build does not provide a matching bundled runtime.`,
      diagnostic: { key: 'unavailable', params: { pluginId: record.pluginId } },
      displayName: record.pluginId,
      managedByApp: false,
    };
  }

  const bundledPlugin =
    record.status === 'loaded' || hasBundledPlugin(record.pluginId)
      ? await loadBundledPlugin(record.pluginId)
      : undefined;

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
  const installDirectory = await window.lingua.plugins.getInstallDirectory();
  const installed = await window.lingua.plugins.list();

  unregisterManagedPlugins();

  return {
    installDirectory,
    plugins: await Promise.all(installed.map(normalizePluginRecord)),
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

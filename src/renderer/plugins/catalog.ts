import type { RunLangPlugin } from './index';

const bundledPluginLoaders: Record<string, () => Promise<RunLangPlugin>> = {
  lua: async () => (await import('./lua-runner')).luaPlugin,
};

export async function loadBundledPlugin(pluginId: string): Promise<RunLangPlugin | undefined> {
  const load = bundledPluginLoaders[pluginId];
  if (!load) return undefined;
  return load();
}

export function hasBundledPlugin(pluginId: string): boolean {
  return pluginId in bundledPluginLoaders;
}

export function getBundledPluginIds(): string[] {
  return Object.keys(bundledPluginLoaders);
}

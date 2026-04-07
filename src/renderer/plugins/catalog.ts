import type { RunLangPlugin } from './index';
import { luaPlugin } from './lua-runner';

const bundledPlugins: Record<string, RunLangPlugin> = {
  [luaPlugin.id]: luaPlugin,
};

export function getBundledPlugin(pluginId: string): RunLangPlugin | undefined {
  return bundledPlugins[pluginId];
}

export function getBundledPluginIds(): string[] {
  return Object.keys(bundledPlugins);
}

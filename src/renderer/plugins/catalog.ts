import { BUNDLED_PLUGIN_IDS } from '../../shared/plugins/manifest';
import type { LinguaPlugin } from './index';

/**
 * Loader map for bundled runtimes. Keys MUST be a subset of
 * `BUNDLED_PLUGIN_IDS` from the shared manifest module — the type
 * assertion below enforces it at compile time so `BUNDLED_PLUGIN_IDS`
 * stays the single source of truth across main + renderer (RL-084).
 */
const bundledPluginLoaders: Record<(typeof BUNDLED_PLUGIN_IDS)[number], () => Promise<LinguaPlugin>> = {
  lua: async () => (await import('./lua-runner')).luaPlugin,
};

function hasOwnBundledPlugin(pluginId: string): pluginId is keyof typeof bundledPluginLoaders {
  return Object.prototype.hasOwnProperty.call(bundledPluginLoaders, pluginId);
}

export async function loadBundledPlugin(pluginId: string): Promise<LinguaPlugin | undefined> {
  if (!hasOwnBundledPlugin(pluginId)) return undefined;
  return bundledPluginLoaders[pluginId]();
}

export function hasBundledPlugin(pluginId: string): boolean {
  return hasOwnBundledPlugin(pluginId);
}

/**
 * Re-export the shared allowlist as a string array so existing
 * consumers that expected a `string[]` shape keep working without a
 * compile break. The shared module's `BUNDLED_PLUGIN_IDS` is a
 * `readonly tuple` for stricter typing at the schema level.
 */
export function getBundledPluginIds(): string[] {
  return [...BUNDLED_PLUGIN_IDS];
}

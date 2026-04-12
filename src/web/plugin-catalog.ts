import type { LinguaPlugin } from '../renderer/plugins';

export async function loadBundledPlugin(_pluginId: string): Promise<LinguaPlugin | undefined> {
  return undefined;
}

export function hasBundledPlugin(_pluginId: string): boolean {
  return false;
}

export function getBundledPluginIds(): string[] {
  return [];
}

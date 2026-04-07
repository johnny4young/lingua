import type { RunLangPlugin } from '../renderer/plugins';

export async function loadBundledPlugin(_pluginId: string): Promise<RunLangPlugin | undefined> {
  return undefined;
}

export function hasBundledPlugin(_pluginId: string): boolean {
  return false;
}

export function getBundledPluginIds(): string[] {
  return [];
}

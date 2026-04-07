import { app, ipcMain } from 'electron';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PLUGIN_API_VERSION = 1;
const MANIFEST_NAME = 'plugin.json';

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(left.length, right.length);

  for (let index = 0; index < max; index += 1) {
    const lhs = left[index] ?? 0;
    const rhs = right[index] ?? 0;
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
  }

  return 0;
}

export function getPluginInstallDirectory(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

function validateManifest(
  manifest: unknown,
  manifestPath: string,
  appVersion: string
): InstalledPluginRecord {
  const installDirectory = path.dirname(manifestPath);

  if (!manifest || typeof manifest !== 'object') {
    return {
      pluginId: path.basename(installDirectory),
      manifestPath,
      installDirectory,
      apiVersion: null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest must be a JSON object.',
    };
  }

  const candidate = manifest as Partial<InstalledPluginManifest>;

  if (!candidate.pluginId || typeof candidate.pluginId !== 'string') {
    return {
      pluginId: path.basename(installDirectory),
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: false,
      status: 'invalid',
      message: 'Manifest must declare a string pluginId.',
    };
  }

  if (candidate.apiVersion !== PLUGIN_API_VERSION) {
    return {
      pluginId: candidate.pluginId,
      manifestPath,
      installDirectory,
      apiVersion: typeof candidate.apiVersion === 'number' ? candidate.apiVersion : null,
      enabled: candidate.enabled !== false,
      status: 'incompatible',
      message: `Plugin API version ${String(candidate.apiVersion)} is not supported. Expected ${PLUGIN_API_VERSION}.`,
    };
  }

  if (candidate.minAppVersion && compareVersions(appVersion, candidate.minAppVersion) < 0) {
    return {
      pluginId: candidate.pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: candidate.enabled !== false,
      status: 'incompatible',
      message: `Plugin requires app version >= ${candidate.minAppVersion}.`,
    };
  }

  if (candidate.maxAppVersion && compareVersions(appVersion, candidate.maxAppVersion) > 0) {
    return {
      pluginId: candidate.pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: candidate.enabled !== false,
      status: 'incompatible',
      message: `Plugin requires app version <= ${candidate.maxAppVersion}.`,
    };
  }

  if (candidate.enabled === false) {
    return {
      pluginId: candidate.pluginId,
      manifestPath,
      installDirectory,
      apiVersion: candidate.apiVersion,
      enabled: false,
      status: 'disabled',
      message: 'Plugin is installed but disabled in its manifest.',
    };
  }

  return {
    pluginId: candidate.pluginId,
    manifestPath,
    installDirectory,
    apiVersion: candidate.apiVersion,
    enabled: true,
    status: 'loaded',
    message: 'Plugin manifest is valid.',
  };
}

export async function listInstalledPlugins(
  pluginDirectory = getPluginInstallDirectory(),
  appVersion = app.getVersion()
): Promise<InstalledPluginRecord[]> {
  await mkdir(pluginDirectory, { recursive: true });
  const entries = await readdir(pluginDirectory, { withFileTypes: true });
  const results: InstalledPluginRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const installDirectory = path.join(pluginDirectory, entry.name);
    const manifestPath = path.join(installDirectory, MANIFEST_NAME);

    try {
      const raw = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      results.push(validateManifest(parsed, manifestPath, appVersion));
    } catch (error) {
      results.push({
        pluginId: entry.name,
        manifestPath,
        installDirectory,
        apiVersion: null,
        enabled: false,
        status: 'invalid',
        message:
          error instanceof Error
            ? `Failed to load plugin manifest: ${error.message}`
            : 'Failed to load plugin manifest.',
      });
    }
  }

  return results.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

export function registerPluginHandlers(): void {
  ipcMain.handle('plugins:get-install-directory', async () => getPluginInstallDirectory());
  ipcMain.handle('plugins:list', async () => listInstalledPlugins());
}

export const pluginManifestHelpers = {
  compareVersions,
  validateManifest,
};
